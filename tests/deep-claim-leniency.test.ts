import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  verifyClaims,
  claimVerdictSchema,
  claimBatchSchema,
} from "@/server/review/deep/claims";
import { analyseTone } from "@/server/review/deep/tone";
import { filterFindings } from "@/server/review/validate";
import { AiError } from "@/server/ai/errors";
import type { AiAdapter } from "@/server/ai/adapter";
import type { NormalizedDocument } from "@/server/ingest/types";
import * as retrieveModule from "@/server/review/deep/retrieve";

describe("Deep claim leniency, partial verdict recovery, and tone resilience", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AI_CLAIM_BATCH_SIZE = "6";
    process.env.AI_TONE_CHUNK_CHARS = "6000";
    process.env.EMBED_BATCH_SIZE = "32";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("claimBatchSchema accepts items with missing fields but rejects a non-array verdicts", () => {
    const validBatch = claimBatchSchema.safeParse({
      verdicts: [
        {
          index: 0,
          verdict: "contradicted",
          explanation: "Claims 50 estates; approved claim says 38.",
          cited_source_code: "AC-1",
        },
      ],
    });
    expect(validBatch.success).toBe(true);

    const nonArrayBatch = claimBatchSchema.safeParse({ verdicts: "invalid" });
    expect(nonArrayBatch.success).toBe(false);

    const emptyObj = claimBatchSchema.safeParse({});
    expect(emptyObj.success).toBe(false);
  });

  it("main case: reconstructed reply defaults confidence to 0.5, suggested_rewrite to null, and filterFindings downgrades to question", async () => {
    const rawVerdict = {
      index: 0,
      verdict: "contradicted",
      explanation: "Claims 50 estates; approved claim says 38.",
      cited_source_code: "AC-1",
    };

    const parsed = claimVerdictSchema.parse(rawVerdict);
    expect(parsed.confidence).toBe(0.5);
    expect(parsed.suggested_rewrite).toBeNull();
    expect(parsed.cited_source_code).toBe("AC-1");

    // Test through verifyClaims
    const doc: NormalizedDocument = {
      version: 1,
      sourceKind: "text",
      title: "Test Doc",
      blocks: [
        {
          id: "b1",
          kind: "paragraph",
          text: "Every pouch is sourced from over 50 estates across Assam and Darjeeling.",
        },
      ],
      images: [],
      stats: { chars: 72, blocks: 1, images: 0 },
    };

    vi.spyOn(retrieveModule, "retrieveForSentence").mockResolvedValue({
      claims: [
        {
          code: "AC-1",
          text: "14 partner estates across Assam and Darjeeling",
          similarity: 0.9,
        },
      ],
      guidelines: [],
      mode: "keyword",
      externalCalls: 0,
    });

    const mockAdapter: AiAdapter = {
      complete: vi.fn().mockResolvedValue({
        data: {
          verdicts: [
            {
              index: 0,
              verdict: "contradicted",
              explanation: "Claims 50 estates; approved claim says 38.",
              cited_source_code: "AC-1",
            },
          ],
        },
        provider: "test",
        model: "test-model",
        ms: 10,
        calls: 1,
      }),
      embed: vi.fn(),
    };

    const res = await verifyClaims({
      brandId: "brand-1",
      doc,
      adapter: mockAdapter,
      claimsPolicy: null,
    });

    expect(res.findings).toHaveLength(1);
    const finding = res.findings[0];
    expect(finding.source.code).toBe("AC-1");
    expect(finding.confidence).toBe(0.5);
    expect(finding.severity).toBe("error"); // initial severity from applyVerdict

    // filterFindings downgrades finding with confidence 0.5 < 0.6 to question
    const filtered = filterFindings(res.findings, {
      codes: new Set(["AC-1"]),
      blockText: new Map([["b1", doc.blocks[0].text]]),
    });

    expect(filtered.kept).toHaveLength(1);
    expect(filtered.kept[0].severity).toBe("question");
    expect(filtered.kept[0].source.code).toBe("AC-1");
  });

  it("handles batch with missing confidence, missing suggested_rewrite, unknown index, and malformed item", async () => {
    // 3 candidates in document (using keywords that match CLAIM_RE)
    const doc: NormalizedDocument = {
      version: 1,
      sourceKind: "text",
      title: "Test Doc",
      blocks: [
        {
          id: "b1",
          kind: "paragraph",
          text: "Every pouch is 100% organic. Sourced from over 50 partner estates. Packaging is 100% recyclable.",
        },
      ],
      images: [],
      stats: { chars: 98, blocks: 1, images: 0 },
    };

    vi.spyOn(retrieveModule, "retrieveForSentence").mockResolvedValue({
      claims: [{ code: "AC-1", text: "Approved claim text", similarity: 0.9 }],
      guidelines: [],
      mode: "keyword",
      externalCalls: 0,
    });

    const log: string[] = [];
    const mockAdapter: AiAdapter = {
      complete: vi.fn().mockResolvedValue({
        data: {
          verdicts: [
            // 1. Missing confidence
            {
              index: 0,
              verdict: "supported",
              cited_source_code: "AC-1",
              explanation: "Matches claim",
              suggested_rewrite: null,
            },
            // 2. Missing suggested_rewrite
            {
              index: 1,
              verdict: "supported",
              cited_source_code: "AC-1",
              confidence: 0.9,
              explanation: "Matches claim",
            },
            // 3. Unknown index
            {
              index: 99,
              verdict: "supported",
              cited_source_code: "AC-1",
              confidence: 0.9,
              explanation: "Matches claim",
              suggested_rewrite: null,
            },
            // 4. Fully malformed item
            {
              not_a_valid_key: 123,
            },
          ],
        },
        provider: "test",
        model: "test-model",
        ms: 10,
        calls: 1,
      }),
      embed: vi.fn(),
    };

    const res = await verifyClaims({
      brandId: "brand-1",
      doc,
      adapter: mockAdapter,
      claimsPolicy: null,
      log,
    });

    // Skips malformed item
    // Unknown index 99 counted in discarded
    expect(res.discarded).toBe(1);
    // Verified contains AC-1 (from index 0 and 1)
    expect(res.verified).toContain("AC-1");
    // Candidate 2 had no valid verdict, reported as not verified
    expect(log).toContain("1 sentences were not verified");
  });

  it("throws AiError(invalid_output) when all items in non-empty batch are malformed or verdicts array is empty", async () => {
    const doc: NormalizedDocument = {
      version: 1,
      sourceKind: "text",
      title: "Test Doc",
      blocks: [
        {
          id: "b1",
          kind: "paragraph",
          text: "Every pouch is 100% organic.",
        },
      ],
      images: [],
      stats: { chars: 28, blocks: 1, images: 0 },
    };

    vi.spyOn(retrieveModule, "retrieveForSentence").mockResolvedValue({
      claims: [{ code: "AC-1", text: "Approved claim text", similarity: 0.9 }],
      guidelines: [],
      mode: "keyword",
      externalCalls: 0,
    });

    // Case A: All items malformed
    const mockAllMalformedAdapter: AiAdapter = {
      complete: vi.fn().mockResolvedValue({
        data: {
          verdicts: [
            { gibberish: true },
            { verdict: "invalid_verdict_type", index: "not-a-number" },
          ],
        },
        provider: "test",
        model: "test-model",
        ms: 10,
        calls: 1,
      }),
      embed: vi.fn(),
    };

    await expect(
      verifyClaims({
        brandId: "brand-1",
        doc,
        adapter: mockAllMalformedAdapter,
        claimsPolicy: null,
      }),
    ).rejects.toThrow(AiError);

    // Case B: verdicts array is empty for non-empty batch
    const mockEmptyVerdictsAdapter: AiAdapter = {
      complete: vi.fn().mockResolvedValue({
        data: { verdicts: [] },
        provider: "test",
        model: "test-model",
        ms: 10,
        calls: 1,
      }),
      embed: vi.fn(),
    };

    await expect(
      verifyClaims({
        brandId: "brand-1",
        doc,
        adapter: mockEmptyVerdictsAdapter,
        claimsPolicy: null,
      }),
    ).rejects.toThrow(AiError);
  });

  it("tone reply with one bad issue keeps the valid issues", async () => {
    const doc: NormalizedDocument = {
      version: 1,
      sourceKind: "text",
      title: "Test Doc",
      blocks: [
        {
          id: "b1",
          kind: "paragraph",
          text: "Our BEST tea bags in India!! Loved by tea drinkers everywhere.",
        },
      ],
      images: [],
      stats: { chars: 62, blocks: 1, images: 0 },
    };

    const mockAdapter: AiAdapter = {
      complete: vi.fn().mockResolvedValue({
        data: {
          issues: [
            // Malformed issue: missing required blockId, quote, issue, etc.
            { invalid_key: "bad" },
            // Valid issue with missing confidence (defaults to 0.5) and missing suggested_rewrite (defaults to null)
            {
              blockId: "b1",
              quote: "BEST tea bags",
              issue: "Avoid exaggerated claims",
              cited_source_code: "GL-Voice-1",
            },
          ],
        },
        provider: "test",
        model: "test-model",
        ms: 10,
        calls: 1,
      }),
      embed: vi.fn(),
    };

    const res = await analyseTone({
      doc,
      voiceSections: [
        { code: "GL-Voice-1", body: "Speak in humble, authentic tone." },
      ],
      adapter: mockAdapter,
    });

    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].matchedText).toBe("BEST tea bags");
    expect(res.findings[0].confidence).toBe(0.5);
    expect(res.findings[0].suggestion).toBeNull();
    expect(res.discarded).toBe(1); // The malformed issue was discarded
  });
});
