import { z } from "zod";
import { AI_TIMEOUT_MS } from "@/lib/config";
import type { AiAdapter } from "@/server/ai/adapter";
import type { Finding } from "../types";
import { extractClaimCandidates, isHardFactualClaim } from "./candidates";
import { CLAIM_VERDICT_SYSTEM } from "./prompts";
import { retrieveForSentence, type Retrieved } from "./retrieve";
import { withRetries } from "./retry";
import { pickSafeRewrite } from "./rewrite";
import type { NormalizedDocument } from "@/server/ingest/types";

export const claimVerdictSchema = z.object({
  verdict: z.enum(["supported", "contradicted", "unsupported", "not_a_claim"]),
  cited_source_code: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(200),
  suggested_rewrite: z.string().nullable(),
});

export async function verifyClaims(args: {
  brandId: string;
  doc: NormalizedDocument;
  adapter: AiAdapter;
  claimsPolicy: { code: string; body: string } | null;
}): Promise<{
  findings: Finding[];
  verified: string[];
  discarded: number;
  externalCalls: number;
  retrieval: "vector" | "keyword" | "none";
}> {
  const candidates = extractClaimCandidates(args.doc.blocks);
  const findings: Finding[] = [];
  const verified: string[] = [];
  let discarded = 0;
  let externalCalls = 0;
  let retrieval: "vector" | "keyword" | "none" = "none";

  for (const candidate of candidates) {
    const retrieved = await retrieveForSentence(args.brandId, candidate.sentence);
    externalCalls += retrieved.externalCalls;
    if (retrieval === "none") {
      retrieval = retrieved.mode;
    } else if (retrieved.mode === "keyword") {
      retrieval = "keyword";
    }

    const user = JSON.stringify({
      sentence: candidate.sentence,
      approved_claims: retrieved.claims.map((c: Retrieved) => ({
        id: c.code,
        text: c.text,
      })),
      guideline_sections: retrieved.guidelines.map((g: Retrieved) => ({
        id: g.code,
        text: g.text,
      })),
    });
    const result = await withRetries(() =>
      args.adapter.complete({
        system: CLAIM_VERDICT_SYSTEM,
        user,
        schema: claimVerdictSchema,
        timeoutMs: AI_TIMEOUT_MS,
      }),
    );
    externalCalls += 1;
    const data = claimVerdictSchema.parse(result.data);
    const citedClaim = retrieved.claims.find(
      (claim) => claim.code === data.cited_source_code,
    );

    if (data.verdict === "supported") {
      if (citedClaim) verified.push(citedClaim.code);
      continue;
    }
    if (data.verdict === "not_a_claim") continue;

    if (data.verdict === "contradicted") {
      if (!citedClaim) {
        discarded += 1;
        continue;
      }
      findings.push({
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
      });
      continue;
    }

    const citedGuide = retrieved.guidelines.find(
      (guide) => guide.code === data.cited_source_code,
    );
    const sourceCode = args.claimsPolicy?.code ?? citedGuide?.code;
    if (!sourceCode) {
      discarded += 1;
      continue;
    }
    const snapshot =
      args.claimsPolicy?.body ?? citedGuide?.text ?? data.explanation;
    findings.push({
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
    });
  }

  return {
    findings,
    verified: [...new Set(verified)],
    discarded,
    externalCalls,
    retrieval,
  };
}
