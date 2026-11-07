import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { verifyClaims, applyVerdict } from "@/server/review/deep/claims";
import { analyseTone } from "@/server/review/deep/tone";
import type { AiAdapter } from "@/server/ai/adapter";
import type { NormalizedDocument } from "@/server/ingest/types";
import { createDeepStats } from "@/server/review/deep/stats";
import * as retrieveModule from "@/server/review/deep/retrieve";

describe("Deep review batching, call count reduction, and verdict logic", () => {
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

  const demoDoc: NormalizedDocument = {
    version: 1,
    sourceKind: "text",
    title: "Kettle & Co. Monsoon Blend",
    blocks: [
      { id: "b1", kind: "heading", text: "Kettle & Co. Monsoon Blend", level: 1 },
      {
        id: "b2",
        kind: "paragraph",
        text: "Our BEST tea bags in India!! Loved by tea drinkers everywhere, and cheap too.",
      },
      {
        id: "b3",
        kind: "paragraph",
        text: "Every pouch is sourced from over 50 estates across Assam and Darjeeling, and it is 100% organic. Packaging is 100% recyclable. Ask any of our clients.",
      },
    ],
    images: [],
    stats: { chars: 250, blocks: 3, images: 0 },
  };

  it("applyVerdict correctly handles supported, contradicted, unapproved, and forged codes", () => {
    const candidate = {
      blockId: "b3",
      sentence: "Every pouch is sourced from over 50 estates across Assam and Darjeeling",
      start: 0,
      end: 71,
    };
    const retrieved = {
      claims: [
        {
          code: "AC-1",
          text: "14 partner estates across Assam and Darjeeling",
          similarity: 0.85,
        },
      ],
      guidelines: [
        {
          code: "GL-4.2",
          text: "All factual claims require prior signoff.",
          similarity: 0.7,
        },
      ],
    };

    // 1. Contradicted finding citing AC-1 survives
    const contradictedRes = applyVerdict(
      candidate,
      retrieved,
      {
        verdict: "contradicted",
        cited_source_code: "AC-1",
        confidence: 0.95,
        explanation: "Mentions 50 estates but approved claim specifies 14.",
        suggested_rewrite: null,
      },
      { code: "GL-4.2", body: "Claims policy" },
    );
    expect(contradictedRes.finding).toBeDefined();
    expect(contradictedRes.finding?.source.code).toBe("AC-1");
    expect(contradictedRes.finding?.kind).toBe("Claim check");
    expect(contradictedRes.finding?.severity).toBe("error");

    // 2. Forged code on contradicted is dropped and discarded
    const forgedRes = applyVerdict(
      candidate,
      retrieved,
      {
        verdict: "contradicted",
        cited_source_code: "NON_EXISTENT_AC",
        confidence: 0.95,
        explanation: "Contradicts fake claim",
        suggested_rewrite: null,
      },
      null,
    );
    expect(forgedRes.finding).toBeUndefined();
    expect(forgedRes.discarded).toBe(true);

    // 3. Supported claim adds to verified
    const supportedRes = applyVerdict(
      candidate,
      retrieved,
      {
        verdict: "supported",
        cited_source_code: "AC-1",
        confidence: 0.99,
        explanation: "Matches AC-1",
        suggested_rewrite: null,
      },
      null,
    );
    expect(supportedRes.verified).toBe("AC-1");
    expect(supportedRes.finding).toBeUndefined();

    // 4. Not a claim returns nothing
    const notClaimRes = applyVerdict(
      candidate,
      retrieved,
      {
        verdict: "not_a_claim",
        cited_source_code: null,
        confidence: 0.9,
        explanation: "General opinion",
        suggested_rewrite: null,
      },
      null,
    );
    expect(notClaimRes.finding).toBeUndefined();
    expect(notClaimRes.discarded).toBeUndefined();
  });

  it("demo text runs in <= 5 provider calls (1 embed + 1 claim batch + 1 tone = 3)", async () => {
    // Mock retrieveForSentence so it doesn't need DB
    vi.spyOn(retrieveModule, "retrieveForSentence").mockImplementation(
      async (_brandId, sentence) => {
        if (sentence.includes("50 estates")) {
          return {
            claims: [
              {
                code: "AC-1",
                text: "14 partner estates across Assam and Darjeeling",
                similarity: 0.88,
              },
            ],
            guidelines: [],
            mode: "vector",
            externalCalls: 0,
          };
        }
        return { claims: [], guidelines: [], mode: "vector", externalCalls: 0 };
      },
    );

    let chatCalls = 0;
    let embedCalls = 0;

    const mockAdapter: AiAdapter = {
      async embed(texts: string[]) {
        embedCalls++;
        return {
          vectors: texts.map(() => new Array(1536).fill(0.1)),
          provider: "mock",
          model: "mock-embed",
          calls: 1,
        };
      },
      async complete(args) {
        chatCalls++;
        if (args.system.includes("Voice guideline sections")) {
          // Tone call
          return {
            data: { issues: [] },
            provider: "mock",
            model: "mock-chat",
            ms: 50,
            calls: 1,
          };
        }
        // Claim batch call
        const userObj = JSON.parse(args.user) as {
          items: { index: number; sentence: string }[];
        };
        const verdicts = userObj.items.map((it) => {
          if (it.sentence.includes("50 estates")) {
            return {
              index: it.index,
              verdict: "contradicted" as const,
              cited_source_code: "AC-1",
              confidence: 0.95,
              explanation: "Claims 50 estates, but approved claim AC-1 allows only 14.",
              suggested_rewrite: null,
            };
          }
          return {
            index: it.index,
            verdict: "not_a_claim" as const,
            cited_source_code: null,
            confidence: 0.9,
            explanation: "No factual claim",
            suggested_rewrite: null,
          };
        });
        return {
          data: { verdicts },
          provider: "mock",
          model: "mock-chat",
          ms: 100,
          calls: 1,
        };
      },
    };

    const ctx = createDeepStats();
    process.env.AI_ENABLED = "true";
    process.env.AI_BASE_URL = "https://mock.api";
    process.env.AI_API_KEY = "test-key";
    process.env.EMBEDDING_MODEL = "test-embed";
    process.env.AI_MODEL = "test-model";

    const claimsResult = await verifyClaims({
      brandId: "mock-brand",
      doc: demoDoc,
      adapter: mockAdapter,
      claimsPolicy: { code: "GL-4.2", body: "All claims must be approved" },
      ctx,
    });

    const toneResult = await analyseTone({
      doc: demoDoc,
      voiceSections: [{ code: "GL-2.1", body: "Warm tone" }],
      adapter: mockAdapter,
      ctx,
    });
    expect(toneResult.findings).toEqual([]);

    // 1 embed + 1 claim batch + 1 tone = 3 calls total
    expect(embedCalls).toBe(1);
    expect(chatCalls).toBe(2);
    expect(ctx.calls).toBeLessThanOrEqual(5);
    expect(ctx.calls).toBe(3);

    // Contradicted AC-1 finding was generated
    const ac1Finding = claimsResult.findings.find(
      (f) => f.source.code === "AC-1" && f.kind === "Claim check",
    );
    expect(ac1Finding).toBeDefined();
    expect(ac1Finding?.severity).toBe("error");
    expect(ac1Finding?.matchedText).toContain("50 estates");
  });

  it("handles missing candidate verdicts (counts unverified) and unknown indices (counts discarded)", async () => {
    vi.spyOn(retrieveModule, "retrieveForSentence").mockImplementation(
      async () => ({
        claims: [],
        guidelines: [{ code: "GL-4.2", text: "Claims policy", similarity: 0.8 }],
        mode: "keyword",
        externalCalls: 0,
      }),
    );

    const log: string[] = [];
    const mockAdapter: AiAdapter = {
      async embed() {
        return { vectors: [], provider: "mock", model: "m", calls: 0 };
      },
      async complete() {
        return {
          data: {
            verdicts: [
              // Index 0 provided
              {
                index: 0,
                verdict: "not_a_claim" as const,
                cited_source_code: null,
                confidence: 0.9,
                explanation: "none",
                suggested_rewrite: null,
              },
              // Index 999 is unknown!
              {
                index: 999,
                verdict: "supported" as const,
                cited_source_code: "GL-4.2",
                confidence: 0.9,
                explanation: "none",
                suggested_rewrite: null,
              },
              // Index 1, 2, ... are missing!
            ],
          },
          provider: "mock",
          model: "mock-chat",
          ms: 50,
          calls: 1,
        };
      },
    };

    const res = await verifyClaims({
      brandId: "brand-1",
      doc: demoDoc, // has multiple candidate sentences
      adapter: mockAdapter,
      claimsPolicy: { code: "GL-4.2", body: "Policy" },
      log,
    });

    // Unknown index 999 was counted in discarded
    expect(res.discarded).toBeGreaterThanOrEqual(1);
    // Missing indices logged
    expect(log.some((l) => l.includes("were not verified"))).toBe(true);
  });
});
