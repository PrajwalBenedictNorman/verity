import { describe, expect, it, vi } from "vitest";
import { analyseTone, toneSchema, toneIssueSchema } from "@/server/review/deep/tone";
import { AiError } from "@/server/ai/errors";
import type { AiAdapter } from "@/server/ai/adapter";
import type { NormalizedDocument } from "@/server/ingest/types";

describe("Tone verification envelope leniency, item validation, and error recovery", () => {
  const sampleDoc: NormalizedDocument = {
    version: 1,
    sourceKind: "text",
    title: "Sample",
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

  const voiceSections = [
    { code: "GL-Voice-1", body: "Speak in humble, authentic tone." },
  ];

  it("envelope schema: accepts missing key, bare array, and empty object {}", () => {
    // 1. Missing key in object
    const missingKey = toneSchema.safeParse({ something_else: 123 });
    expect(missingKey.success).toBe(true);
    if (missingKey.success) {
      expect(missingKey.data.issues).toEqual([]);
    }

    // 2. Empty object {}
    const emptyObj = toneSchema.safeParse({});
    expect(emptyObj.success).toBe(true);
    if (emptyObj.success) {
      expect(emptyObj.data.issues).toEqual([]);
    }

    // 3. Bare array
    const bareArray = toneSchema.safeParse([
      {
        blockId: "b1",
        quote: "BEST tea bags",
        issue: "Tone issue",
        cited_source_code: "GL-Voice-1",
      },
    ]);
    expect(bareArray.success).toBe(true);
    if (bareArray.success) {
      expect(bareArray.data.issues).toHaveLength(1);
    }
  });

  it("item schema: defaults confidence to 0.5, suggested_rewrite and cited_source_code to null", () => {
    const item = toneIssueSchema.parse({
      blockId: "b1",
      quote: "BEST tea bags",
      issue: "Tone issue",
    });
    expect(item.confidence).toBe(0.5);
    expect(item.suggested_rewrite).toBeNull();
    expect(item.cited_source_code).toBeNull();
  });

  it("analyseTone: missing key produces no issues without error", async () => {
    const mockAdapter: AiAdapter = {
      complete: vi.fn().mockResolvedValue({
        data: { message: "No problems found" }, // missing 'issues' key
        provider: "test",
        model: "test-model",
        ms: 10,
        calls: 1,
      }),
      embed: vi.fn(),
    };

    const res = await analyseTone({
      doc: sampleDoc,
      voiceSections,
      adapter: mockAdapter,
    });

    expect(res.findings).toEqual([]);
    expect(res.discarded).toBe(0);
  });

  it("analyseTone: bare array is accepted and findings extracted", async () => {
    const mockAdapter: AiAdapter = {
      complete: vi.fn().mockResolvedValue({
        data: [
          {
            blockId: "b1",
            quote: "BEST tea bags",
            issue: "Avoid superlatives",
            cited_source_code: "GL-Voice-1",
          },
        ],
        provider: "test",
        model: "test-model",
        ms: 10,
        calls: 1,
      }),
      embed: vi.fn(),
    };

    const res = await analyseTone({
      doc: sampleDoc,
      voiceSections,
      adapter: mockAdapter,
    });

    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].matchedText).toBe("BEST tea bags");
    expect(res.findings[0].confidence).toBe(0.5);
    expect(res.findings[0].source.code).toBe("GL-Voice-1");
  });

  it("analyseTone: empty object {} produces no issues without error", async () => {
    const mockAdapter: AiAdapter = {
      complete: vi.fn().mockResolvedValue({
        data: {},
        provider: "test",
        model: "test-model",
        ms: 10,
        calls: 1,
      }),
      embed: vi.fn(),
    };

    const res = await analyseTone({
      doc: sampleDoc,
      voiceSections,
      adapter: mockAdapter,
    });

    expect(res.findings).toEqual([]);
    expect(res.discarded).toBe(0);
  });

  it("analyseTone: one bad issue among good ones skips the bad issue and counts it as discarded", async () => {
    const mockAdapter: AiAdapter = {
      complete: vi.fn().mockResolvedValue({
        data: {
          issues: [
            // Bad issue 1: completely malformed
            { gibberish: true },
            // Bad issue 2: missing cited_source_code (null)
            {
              blockId: "b1",
              quote: "BEST tea bags",
              issue: "No citation provided",
              cited_source_code: null,
            },
            // Good issue
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
      doc: sampleDoc,
      voiceSections,
      adapter: mockAdapter,
    });

    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].matchedText).toBe("BEST tea bags");
    expect(res.discarded).toBe(2); // 1 malformed + 1 missing cited_source_code
  });

  it("analyseTone: fully unreadable reply skips chunk with log line and sets partial: true", async () => {
    const log: string[] = [];
    const mockAdapter: AiAdapter = {
      complete: vi.fn().mockRejectedValue(new AiError("invalid_output", false)),
      embed: vi.fn(),
    };

    const res = await analyseTone({
      doc: sampleDoc,
      voiceSections,
      adapter: mockAdapter,
      log,
    });

    expect(res.findings).toEqual([]);
    expect(res.partial).toBe(true);
    expect(log).toContain("Tone check skipped: the AI answer could not be read");
  });

  it("analyseTone: provider error (quota, auth, outage) is rethrown and NOT caught", async () => {
    const log: string[] = [];
    const mockQuotaAdapter: AiAdapter = {
      complete: vi.fn().mockRejectedValue(new AiError("quota_exceeded", false, 429)),
      embed: vi.fn(),
    };

    await expect(
      analyseTone({
        doc: sampleDoc,
        voiceSections,
        adapter: mockQuotaAdapter,
        log,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "quota_exceeded" }));
    expect(log).not.toContain("Tone check skipped: the AI answer could not be read");
  });
});
