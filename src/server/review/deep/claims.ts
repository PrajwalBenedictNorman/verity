import { z } from "zod";
import { AI_TIMEOUT_MS } from "@/lib/config";
import type { AiAdapter } from "@/server/ai/adapter";
import type { Finding } from "../types";
import { extractClaimCandidates, isHardFactualClaim } from "./candidates";
import { CLAIM_VERDICT_SYSTEM } from "./prompts";
import { retrieveForSentence, type Retrieved } from "./retrieve";
import type { NormalizedDocument } from "@/server/ingest/types";

export const claimVerdictSchema = z.object({
  verdict: z.enum(["supported", "contradicted", "unsupported", "not_a_claim"]),
  cited_source_code: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(200),
  suggested_rewrite: z.string().nullable(),
});

async function withRetries<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
  }
  throw last;
}

export async function verifyClaims(args: {
  brandId: string;
  doc: NormalizedDocument;
  adapter: AiAdapter;
  claimsPolicy: { code: string; body: string } | null;
}): Promise<{
  findings: Finding[];
  verified: string[];
  externalCalls: number;
  retrieval: "vector" | "keyword";
}> {
  const candidates = extractClaimCandidates(args.doc.blocks);
  const findings: Finding[] = [];
  const verified: string[] = [];
  let externalCalls = 0;
  let retrieval: "vector" | "keyword" = "keyword";

  for (const candidate of candidates) {
    const retrieved = await retrieveForSentence(args.brandId, candidate.sentence);
    retrieval = retrieved.mode;
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
    if (data.verdict === "supported") {
      if (data.cited_source_code) verified.push(data.cited_source_code);
      continue;
    }
    if (data.verdict === "not_a_claim") continue;

    const cited = data.cited_source_code;
    const fromClaims = retrieved.claims.find((c) => c.code === cited);
    const fromGuide = retrieved.guidelines.find((g) => g.code === cited);
    const policy = args.claimsPolicy;

    if (data.verdict === "contradicted") {
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
          code: fromClaims?.code ?? cited ?? "AC-?",
          snapshot: fromClaims?.text ?? data.explanation,
        },
        suggestion: data.suggested_rewrite,
        state: "open",
      });
      continue;
    }

    const sourceCode = policy?.code ?? fromGuide?.code ?? cited ?? "GL-4.2";
    const snapshot = policy?.body ?? fromGuide?.text ?? data.explanation;
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
      suggestion: data.suggested_rewrite,
      state: "open",
    });
  }

  return { findings, verified: [...new Set(verified)], externalCalls, retrieval };
}
