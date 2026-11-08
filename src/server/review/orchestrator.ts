import { desc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  activityLog,
  approvedClaims,
  findings,
  guidelineSections,
  reviews,
  submissions,
} from "@/server/db/schema";
import { aiConfigured, getAdapter } from "@/server/ai/adapter";
import { AiError, userMessageFor } from "@/server/ai/errors";
import { logger } from "@/lib/logger";
import { runFastTier } from "./fast/rules";
import { analyseTone } from "./deep/tone";
import { verifyClaims } from "./deep/claims";
import { PROMPT_VERSION } from "./deep/prompts";
import { buildAllowedSourceCodes } from "./deep/sources";
import { createDeepStats, type DeepStats } from "./deep/stats";
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
  opts: { waitForDeep?: boolean; fastOnly?: boolean; skipReason?: string } = {},
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

  const aiOn = aiConfigured() && !opts.fastOnly;
  const skipReason = aiOn
    ? undefined
    : (opts.skipReason ?? (opts.fastOnly ? "not_rerun_after_edit" : undefined));

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
      ...(skipReason ? { skipReason } : {}),
    },
    dropped: 0,
    verifiedClaims: [],
    log: [
      `Fast tier ran: ${fast.findings.length} rule findings, 0 external calls.`,
      ...(aiOn
        ? [
            "Deep checks running. Excerpts of the submitted text will be sent to the configured provider.",
          ]
        : [
            skipReason === "not_rerun_after_edit"
              ? "Deep checks were not re-run after this edit. Click Run review to re-check."
              : "Deep checks off: external AI disabled",
          ]),
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
  const [review] = await db
    .select()
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);
  if (!review) return;
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, review.submissionId))
    .limit(1);
  if (!submission) return;
  const doc = submission.normalized as NormalizedDocument;
  const started = Date.now();
  const deadline = started + Number(process.env.AI_DEEP_BUDGET_MS ?? 120_000);
  const ctx: DeepStats = createDeepStats();
  let retrieval: "vector" | "keyword" | "none" = "none";
  let claimsFinished = false;

  let disclosure: Disclosure = { ...review.disclosure };
  const log = [...(disclosure.log ?? [])];
  let totalDiscarded = review.discardedCount ?? 0;

  try {
    const adapter = getAdapter();
    const [sections, claimRows] = await Promise.all([
      db
        .select()
        .from(guidelineSections)
        .where(eq(guidelineSections.brandId, submission.brandId)),
      db
        .select()
        .from(approvedClaims)
        .where(eq(approvedClaims.brandId, submission.brandId)),
    ]);
    const claimsPolicy = sections.find((s) => s.code === "GL-4.2") ?? null;
    const voiceSections = sections
      .filter((s) => s.category === "Voice")
      .map((s) => ({ code: s.code, body: s.body }));
    const allowedCodes = buildAllowedSourceCodes({
      sections,
      claims: claimRows,
    });
    const blockText = new Map(doc.blocks.map((b) => [b.id, b.text]));

    const claims = await verifyClaims({
      brandId: submission.brandId,
      doc,
      adapter,
      claimsPolicy: claimsPolicy
        ? { code: claimsPolicy.code, body: claimsPolicy.body }
        : null,
      ctx,
      deadline,
      log,
    });
    retrieval = claims.retrieval;
    claimsFinished = true;
    totalDiscarded += claims.discarded;
    if (claims.discarded > 0) {
      log.push(
        `${claims.discarded} claim finding(s) dropped: the cited source was not in the retrieved claims`,
      );
    }
    const claimsFiltered = filterFindings(claims.findings, {
      codes: allowedCodes,
      blockText,
    });
    totalDiscarded += claimsFiltered.discarded;
    log.push(...claimsFiltered.log);
    if (claimsFiltered.kept.length) {
      await db
        .insert(findings)
        .values(
          claimsFiltered.kept.map((f) => findingToInsert(reviewId, f)),
        );
    }

    const afterClaimsRows = await db
      .select()
      .from(findings)
      .where(eq(findings.reviewId, reviewId));
    const afterClaims = afterClaimsRows.map(rowToFinding);
    disclosure = {
      ...disclosure,
      dropped: totalDiscarded,
      verifiedClaims: claims.verified,
      deep: {
        ...disclosure.deep,
        status: "running",
        provider: "openai-compatible",
        chatModel: process.env.AI_MODEL ?? null,
        embeddingModel: process.env.EMBEDDING_MODEL ?? null,
        externalCalls: ctx.calls,
        retries: ctx.retries,
        cacheHits: ctx.cacheHits,
        sentToExternal: "sentence-level excerpts only",
        retrieval,
      },
      log,
    };
    await db
      .update(reviews)
      .set({
        deepMs: Date.now() - started,
        deepStatus: "running",
        score: scoreFindings(afterClaims),
        discardedCount: totalDiscarded,
        verifiedClaimCodes: claims.verified,
        disclosure,
      })
      .where(eq(reviews.id, reviewId));

    const tone = await analyseTone({
      doc,
      voiceSections,
      adapter,
      ctx,
      deadline,
      log,
    });
    totalDiscarded += tone.discarded;
    if (tone.discarded > 0) {
      log.push(
        `${tone.discarded} tone finding(s) dropped: quoted text was not found`,
      );
    }
    const toneFiltered = filterFindings(tone.findings, {
      codes: allowedCodes,
      blockText,
    });
    totalDiscarded += toneFiltered.discarded;
    log.push(...toneFiltered.log);
    if (toneFiltered.kept.length) {
      await db
        .insert(findings)
        .values(toneFiltered.kept.map((f) => findingToInsert(reviewId, f)));
    }

    const allRows = await db
      .select()
      .from(findings)
      .where(eq(findings.reviewId, reviewId));
    const allFindings: Finding[] = allRows.map(rowToFinding);
    log.push(
      `Deep tier ran with openai-compatible/${process.env.AI_MODEL}. Excerpts of your text were sent to it.`,
    );
    disclosure = {
      ...disclosure,
      dropped: totalDiscarded,
      verifiedClaims: claims.verified,
      deep: {
        status: "done",
        provider: "openai-compatible",
        chatModel: process.env.AI_MODEL ?? null,
        embeddingModel: process.env.EMBEDDING_MODEL ?? null,
        externalCalls: ctx.calls,
        retries: ctx.retries,
        cacheHits: ctx.cacheHits,
        sentToExternal: "sentence-level excerpts only",
        retrieval,
        ...(tone.partial ? { partial: true } : {}),
      },
      log,
    };
    const deepMs = Date.now() - started;
    logger.with({ reviewId }).deepSummary({
      ms: deepMs,
      calls: ctx.calls,
      retries: ctx.retries,
      cacheHits: ctx.cacheHits,
      dropped: totalDiscarded,
    });
    await db
      .update(reviews)
      .set({
        deepMs,
        deepStatus: "done",
        score: scoreFindings(allFindings),
        discardedCount: totalDiscarded,
        verifiedClaimCodes: claims.verified,
        finishedAt: new Date(),
        disclosure,
      })
      .where(eq(reviews.id, reviewId));
  } catch (err) {
    const code = err instanceof AiError ? err.code : "unknown";
    const status = err instanceof AiError ? err.status : undefined;
    const providerBody = err instanceof AiError ? err.providerBody : undefined;

    logger.with({ reviewId }).error("Deep tier failed", {
      code,
      status,
      providerBody,
    });

    const safeMessage = userMessageFor(code);
    log.push(safeMessage);

    const existingRows = await db
      .select()
      .from(findings)
      .where(eq(findings.reviewId, reviewId));
    const allFindings = existingRows.map(rowToFinding);

    disclosure = {
      ...disclosure,
      dropped: totalDiscarded,
      deep: {
        ...disclosure.deep,
        status: "failed",
        errorCode: code,
        errorMessage: safeMessage,
        externalCalls: ctx.calls,
        retries: ctx.retries,
        cacheHits: ctx.cacheHits,
        retrieval,
        partial: claimsFinished,
      },
      log,
    };

    await db
      .update(reviews)
      .set({
        deepMs: Date.now() - started,
        deepStatus: "failed",
        score: scoreFindings(allFindings),
        discardedCount: totalDiscarded,
        finishedAt: new Date(),
        disclosure,
      })
      .where(eq(reviews.id, reviewId));

    await logActivity(
      submission.id,
      null,
      "deep_failed",
      safeMessage,
    );
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
  if (!review) return null;

  if (review.deepStatus === "pending" || review.deepStatus === "running") {
    const staleMs = Number(process.env.AI_DEEP_STALE_MS ?? 300_000);
    const age = Date.now() - new Date(review.startedAt).getTime();
    if (age > staleMs) {
      const msg = "Deep checks were interrupted. Fast results are shown.";
      const updatedDisclosure: Disclosure = {
        ...review.disclosure,
        deep: {
          ...review.disclosure.deep,
          status: "failed",
          errorCode: "interrupted",
          errorMessage: msg,
        },
        log: [...(review.disclosure.log ?? []), msg],
      };
      await db
        .update(reviews)
        .set({
          deepStatus: "failed",
          finishedAt: new Date(),
          disclosure: updatedDisclosure,
        })
        .where(eq(reviews.id, review.id));

      await logActivity(submissionId, null, "deep_failed", msg);
      return {
        ...review,
        deepStatus: "failed" as const,
        disclosure: updatedDisclosure,
      };
    }
  }

  return review;
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
