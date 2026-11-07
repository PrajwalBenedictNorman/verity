import { z } from "zod";
import { AI_TIMEOUT_MS } from "@/lib/config";
import type { AiAdapter } from "@/server/ai/adapter";
import { embeddingsConfigured } from "@/server/ai/adapter";
import { AiError } from "@/server/ai/errors";
import type { Finding } from "../types";
import { extractClaimCandidates, isHardFactualClaim, type ClaimCandidate } from "./candidates";
import { CLAIM_VERDICT_SYSTEM } from "./prompts";
import { retrieveForSentence, type Retrieved } from "./retrieve";
import { withRetries } from "./retry";
import { pickSafeRewrite } from "./rewrite";
import type { NormalizedDocument } from "@/server/ingest/types";
import { createDeepStats, type DeepStats } from "./stats";

export const claimVerdictSchema = z.object({
  verdict: z.enum(["supported", "contradicted", "unsupported", "not_a_claim"]),
  cited_source_code: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(200),
  suggested_rewrite: z.string().nullable(),
});

export const claimBatchSchema = z.object({
  verdicts: z.array(
    claimVerdictSchema.extend({
      index: z.number().int().min(0),
    }),
  ),
});

export type ClaimVerdict = z.infer<typeof claimVerdictSchema>;

export function applyVerdict(
  candidate: ClaimCandidate,
  retrieved: { claims: Retrieved[]; guidelines: Retrieved[] },
  data: ClaimVerdict,
  claimsPolicy: { code: string; body: string } | null,
): {
  finding?: Finding;
  verified?: string;
  discarded?: boolean;
} {
  const citedClaim = retrieved.claims.find(
    (claim) => claim.code === data.cited_source_code,
  );

  if (data.verdict === "supported") {
    if (citedClaim) return { verified: citedClaim.code };
    return {};
  }
  if (data.verdict === "not_a_claim") return {};

  if (data.verdict === "contradicted") {
    if (!citedClaim) {
      return { discarded: true };
    }
    return {
      finding: {
        id: crypto.randomUUID(),
        tier: "deep",
        kind: "Claim check",
        severity: "error",
        confidence: data.confidence,
        blockId: candidate.blockId,
        start: candidate.start,
        end: candidate.end,
        matchedText: candidate.sentence,
        message: data.explanation,
        source: {
          type: "claim",
          code: citedClaim.code,
          snapshot: citedClaim.text,
        },
        suggestion: pickSafeRewrite(data.suggested_rewrite, retrieved.claims),
        state: "open",
      },
    };
  }

  const citedGuide = retrieved.guidelines.find(
    (guide) => guide.code === data.cited_source_code,
  );
  const sourceCode = claimsPolicy?.code ?? citedGuide?.code;
  if (!sourceCode) {
    return { discarded: true };
  }
  const snapshot =
    claimsPolicy?.body ?? citedGuide?.text ?? data.explanation;
  return {
    finding: {
      id: crypto.randomUUID(),
      tier: "deep",
      kind: "Unapproved claim",
      severity: isHardFactualClaim(candidate.sentence) ? "error" : "question",
      confidence: data.confidence,
      blockId: candidate.blockId,
      start: candidate.start,
      end: candidate.end,
      matchedText: candidate.sentence,
      message: data.explanation,
      source: { type: "guideline", code: sourceCode, snapshot },
      suggestion: pickSafeRewrite(data.suggested_rewrite, retrieved.claims),
      state: "open",
    },
  };
}

export async function verifyClaims(args: {
  brandId: string;
  doc: NormalizedDocument;
  adapter: AiAdapter;
  claimsPolicy: { code: string; body: string } | null;
  ctx?: DeepStats;
  deadline?: number;
  log?: string[];
}): Promise<{
  findings: Finding[];
  verified: string[];
  discarded: number;
  externalCalls: number;
  retrieval: "vector" | "keyword" | "none";
}> {
  const ctx = args.ctx ?? createDeepStats();
  const candidates = extractClaimCandidates(args.doc.blocks);
  if (candidates.length === 0) {
    return {
      findings: [],
      verified: [],
      discarded: 0,
      externalCalls: ctx.calls,
      retrieval: "none",
    };
  }

  const findings: Finding[] = [];
  const verified: string[] = [];
  let discarded = 0;
  let unverifiedCount = 0;

  const EMBED_BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE ?? 32);
  const CLAIM_BATCH_SIZE = Number(process.env.AI_CLAIM_BATCH_SIZE ?? 6);

  let sentenceVectors: (number[] | null)[] = [];
  let retrieval: "vector" | "keyword" | "none" = "none";

  if (embeddingsConfigured()) {
    try {
      const allVectors: number[][] = [];
      for (let i = 0; i < candidates.length; i += EMBED_BATCH_SIZE) {
        if (args.deadline && Date.now() > args.deadline) {
          throw new AiError(
            "timeout",
            false,
            undefined,
            undefined,
            "Deep review budget exceeded",
          );
        }
        const batchTexts = candidates
          .slice(i, i + EMBED_BATCH_SIZE)
          .map((c) => c.sentence);
        const res = await withRetries(() => args.adapter.embed(batchTexts), {
          ctx,
        });
        if (res.calls > 1) {
          ctx.calls += res.calls - 1;
        }
        allVectors.push(...res.vectors);
      }
      sentenceVectors = allVectors;
      retrieval = "vector";
    } catch (embedErr) {
      if (embedErr instanceof AiError && embedErr.code === "timeout" && !embedErr.retryable) {
        throw embedErr;
      }
      args.log?.push("Embeddings unavailable: using keyword retrieval");
      sentenceVectors = new Array(candidates.length).fill(null);
      retrieval = "keyword";
    }
  } else {
    sentenceVectors = new Array(candidates.length).fill(null);
    retrieval = "keyword";
  }

  // Pre-retrieve for all candidates (0 external calls with passed vector/null)
  const retrievedList: {
    claims: Retrieved[];
    guidelines: Retrieved[];
    mode: "vector" | "keyword";
  }[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const ret = await retrieveForSentence(
      args.brandId,
      candidates[i].sentence,
      sentenceVectors[i],
    );
    retrievedList.push(ret);
  }

  // If all retrievals were keyword, reflect that in overall mode
  if (
    retrieval === "vector" &&
    retrievedList.every((r) => r.mode === "keyword")
  ) {
    retrieval = "keyword";
  }

  // Process claim verdicts in batches
  for (let i = 0; i < candidates.length; i += CLAIM_BATCH_SIZE) {
    if (args.deadline && Date.now() > args.deadline) {
      throw new AiError(
        "timeout",
        false,
        undefined,
        undefined,
        "Deep review budget exceeded",
      );
    }

    const batchCandidates = candidates.slice(i, i + CLAIM_BATCH_SIZE);
    const batchRetrieved = retrievedList.slice(i, i + CLAIM_BATCH_SIZE);

    const items = batchCandidates.map((c, idx) => ({
      index: idx,
      sentence: c.sentence,
      approved_claims: batchRetrieved[idx].claims.map((claim) => ({
        id: claim.code,
        text: claim.text,
      })),
      guideline_sections: batchRetrieved[idx].guidelines.map((g) => ({
        id: g.code,
        text: g.text,
      })),
    }));

    const result = await withRetries(
      () =>
        args.adapter.complete({
          system: CLAIM_VERDICT_SYSTEM,
          user: JSON.stringify({ items }),
          schema: claimBatchSchema,
          timeoutMs: AI_TIMEOUT_MS,
        }),
      { ctx },
    );
    if (result.calls > 1) {
      ctx.calls += result.calls - 1;
    }

    const data = claimBatchSchema.parse(result.data);
    const verdictMap = new Map<number, ClaimVerdict>();

    for (const v of data.verdicts) {
      if (v.index < 0 || v.index >= batchCandidates.length) {
        discarded += 1;
        continue;
      }
      verdictMap.set(v.index, v);
    }

    for (let idx = 0; idx < batchCandidates.length; idx++) {
      const verdict = verdictMap.get(idx);
      if (!verdict) {
        unverifiedCount += 1;
        continue;
      }

      const res = applyVerdict(
        batchCandidates[idx],
        batchRetrieved[idx],
        verdict,
        args.claimsPolicy,
      );
      if (res.discarded) discarded += 1;
      if (res.verified) verified.push(res.verified);
      if (res.finding) findings.push(res.finding);
    }
  }

  if (unverifiedCount > 0) {
    args.log?.push(`${unverifiedCount} sentences were not verified`);
  }

  return {
    findings,
    verified: [...new Set(verified)],
    discarded,
    externalCalls: ctx.calls,
    retrieval,
  };
}
