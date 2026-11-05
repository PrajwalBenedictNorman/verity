import { desc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  activityLog,
  findings,
  guidelineSections,
  reviews,
  submissions,
} from "@/server/db/schema";
import { aiConfigured } from "@/server/ai/adapter";
import { createOpenAiCompatibleAdapter } from "@/server/ai/openai-compatible";
import { runFastTier } from "./fast/rules";
import { analyseTone } from "./deep/tone";
import { verifyClaims } from "./deep/claims";
import { PROMPT_VERSION } from "./deep/prompts";
import { findingToInsert, rowToFinding } from "./map";
import { scoreFindings } from "./scoring";
import { filterFindings } from "./validate";
import type { Disclosure, Finding } from "./types";
import type { NormalizedDocument } from "@/server/ingest/types";

function emptyDisclosure(partial: Partial<Disclosure> = {}): Disclosure {
  return {
    promptVersion: PROMPT_VERSION,
    fast: { ran: true, externalCalls: 0 },
    deep: {
      status: "pending",
      provider: null,
      chatModel: null,
      embeddingModel: null,
      externalCalls: 0,
      sentToExternal: "sentence-level excerpts only",
      retrieval: "none",
    },
    dropped: 0,
    verifiedClaims: [],
    ...partial,
    log: partial.log ?? [],
  };
}

export async function startReview(
  submissionId: string,
  opts: { waitForDeep?: boolean } = {},
) {
  const db = getDb();
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .limit(1);
  if (!submission) throw new Error("Submission not found");
  const doc = submission.normalized;

  const [review] = await db
    .insert(reviews)
    .values({
      submissionId,
      deepStatus: "pending",
      disclosure: emptyDisclosure({
        log: ["Review started."],
      }),
    })
    .returning();
  if (!review) throw new Error("Failed to create review");

  const fastStarted = Date.now();
  const fast = await runFastTier(submission.brandId, doc);
  const fastMs = Date.now() - fastStarted;
  if (fast.findings.length) {
    await db.insert(findings).values(
      fast.findings.map((f) => findingToInsert(review.id, f)),
    );
  }

  const aiOn = aiConfigured();
  const disclosure = emptyDisclosure({
    fast: { ran: true, externalCalls: 0 },
    deep: {
      status: aiOn ? "running" : "skipped",
      provider: aiOn ? "openai-compatible" : null,
      chatModel: aiOn ? (process.env.AI_MODEL ?? null) : null,
      embeddingModel: aiOn ? (process.env.EMBEDDING_MODEL ?? null) : null,
      externalCalls: 0,
      sentToExternal: "sentence-level excerpts only",
      retrieval: "none",
    },
    dropped: 0,
    verifiedClaims: [],
    log: [
      `Fast tier ran: ${fast.findings.length} rule findings, 0 external calls.`,
      ...(aiOn
        ? ["Deep checks running. Excerpts of the submitted text will be sent to the configured provider."]
        : ["Deep checks off: external AI disabled"]),
      ...fast.log,
    ],
  });

  await db
    .update(reviews)
    .set({
      fastMs,
      deepStatus: aiOn ? "running" : "skipped",
      score: aiOn ? null : scoreFindings(fast.findings),
      finishedAt: aiOn ? null : new Date(),
      disclosure,
    })
    .where(eq(reviews.id, review.id));

  const deepPromise = aiOn
    ? runDeep(review.id)
    : Promise.resolve();
  if (opts.waitForDeep) await deepPromise;
  else void deepPromise.catch((err) => console.error("deep tier failed", err));

  return {
    reviewId: review.id,
    fast: fast.findings,
    deepStatus: aiOn ? ("running" as const) : ("skipped" as const),
    fastMs,
  };
}

export async function runDeep(reviewId: string) {
  const db = getDb();
  const [review] = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1);
  if (!review) return;
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, review.submissionId))
    .limit(1);
  if (!submission) return;
  const doc = submission.normalized as NormalizedDocument;
  const started = Date.now();
  const disclosure = { ...review.disclosure };

  try {
    const adapter = createOpenAiCompatibleAdapter();
    const sections = await db
      .select()
      .from(guidelineSections)
      .where(eq(guidelineSections.brandId, submission.brandId));
    const claimsPolicy = sections.find((s) => s.code === "GL-4.2") ?? null;
    const voiceSections = sections
      .filter((s) => s.category === "Voice")
      .map((s) => ({ code: s.code, body: s.body }));

    const claims = await verifyClaims({
      brandId: submission.brandId,
      doc,
      adapter,
      claimsPolicy: claimsPolicy
        ? { code: claimsPolicy.code, body: claimsPolicy.body }
        : null,
    });
    const tone = await analyseTone({ doc, voiceSections, adapter });

    const existing = await db.select().from(findings).where(eq(findings.reviewId, reviewId));
    const codes = new Set(sections.map((s) => s.code));
    for (const c of claims.verified) codes.add(c);
    const filtered = filterFindings([...claims.findings, ...tone.findings], {
      codes,
      blockText: new Map(doc.blocks.map((b) => [b.id, b.text])),
    });
    if (filtered.kept.length) {
      await db.insert(findings).values(filtered.kept.map((f) => findingToInsert(reviewId, f)));
    }
    const allRows = await db.select().from(findings).where(eq(findings.reviewId, reviewId));
    const allFindings: Finding[] = allRows.map(rowToFinding);
    const dropped = filtered.discarded + tone.discarded + (review.discardedCount ?? 0);
    const score = scoreFindings(allFindings);
    const log = [
      ...(disclosure.log ?? []),
      `Deep tier ran with openai-compatible/${process.env.AI_MODEL}. Excerpts of your text were sent to it.`,
      ...filtered.log,
    ];
    await db
      .update(reviews)
      .set({
        deepMs: Date.now() - started,
        deepStatus: "done",
        score,
        discardedCount: dropped,
        verifiedClaimCodes: claims.verified,
        finishedAt: new Date(),
        disclosure: {
          ...disclosure,
          dropped,
          verifiedClaims: claims.verified,
          deep: {
            status: "done",
            provider: "openai-compatible",
            chatModel: process.env.AI_MODEL ?? null,
            embeddingModel: process.env.EMBEDDING_MODEL ?? null,
            externalCalls: claims.externalCalls + tone.externalCalls,
            sentToExternal: "sentence-level excerpts only",
            retrieval: claims.retrieval,
          },
          log,
        },
      })
      .where(eq(reviews.id, reviewId));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deep tier failed";
    const existing = await db.select().from(findings).where(eq(findings.reviewId, reviewId));
    await db
      .update(reviews)
      .set({
        deepMs: Date.now() - started,
        deepStatus: "failed",
        score: scoreFindings(existing.map(rowToFinding)),
        finishedAt: new Date(),
        disclosure: {
          ...disclosure,
          deep: { ...disclosure.deep, status: "failed" },
          log: [...(disclosure.log ?? []), `Deep tier failed: ${message}`],
        },
      })
      .where(eq(reviews.id, reviewId));
  }
}

export async function latestReview(submissionId: string) {
  const db = getDb();
  const [review] = await db
    .select()
    .from(reviews)
    .where(eq(reviews.submissionId, submissionId))
    .orderBy(desc(reviews.startedAt))
    .limit(1);
  return review ?? null;
}

export async function logActivity(
  submissionId: string,
  actorId: string | null,
  action: string,
  detail: string,
) {
  await getDb().insert(activityLog).values({
    submissionId,
    actorId,
    action,
    detail,
  });
}
