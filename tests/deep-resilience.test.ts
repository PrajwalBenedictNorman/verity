import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getTableName, type Table } from "drizzle-orm";
import { AiError } from "@/server/ai/errors";
import { runDeep, latestReview } from "@/server/review/orchestrator";
import * as adapterModule from "@/server/ai/adapter";
import * as dbClientModule from "@/server/db/client";
import * as retrieveModule from "@/server/review/deep/retrieve";
import { aiGuard } from "@/server/ai/guard";
import type { Disclosure } from "@/server/review/types";
import type { NormalizedDocument } from "@/server/ingest/types";

type ReviewRow = {
  id: string;
  submissionId: string;
  deepStatus: "pending" | "running" | "done" | "failed" | "skipped";
  startedAt: Date;
  finishedAt?: Date | null;
  score: number | null;
  discardedCount: number | null;
  disclosure: Disclosure;
  verifiedClaimCodes?: string[];
  deepMs?: number;
};

type SubmissionRow = {
  id: string;
  brandId: string;
  normalized: NormalizedDocument;
};

type FindingRow = {
  id: string;
  reviewId: string;
  kind: string;
  severity: string;
  confidence: number;
  blockId: string;
  startOffset: number;
  endOffset: number;
  matchedText: string;
  message: string;
  sourceType: string;
  sourceCode: string;
  sourceSnapshot: string;
  suggestion: string | null;
  state: string;
};

describe("Deep review resilience and error handling", () => {
  const originalEnv = { ...process.env };

  let mockReviews: ReviewRow[] = [];
  let mockSubmissions: SubmissionRow[] = [];
  let mockFindings: FindingRow[] = [];
  let mockActivityLog: { submissionId: string; action: string; detail: string }[] = [];
  let mockGuidelineSections: { code: string; body: string; category: string }[] = [];
  let mockApprovedClaims: { code: string; text: string; brandId: string }[] = [];

  const mockDb = {
    select: () => ({
      from: (table: Table) => {
        const tableName = getTableName(table);
        return {
          where: () => ({
            limit: async () => {
              if (tableName === "reviews") return [...mockReviews];
              if (tableName === "submissions") return [...mockSubmissions];
              return [];
            },
            orderBy: () => ({
              limit: async () => {
                if (tableName === "reviews") return [...mockReviews];
                return [];
              },
            }),
            then: (onfulfilled?: (val: unknown) => unknown) => {
              let res: unknown[] = [];
              if (tableName === "guideline_sections") res = mockGuidelineSections;
              else if (tableName === "approved_claims") res = mockApprovedClaims;
              else if (tableName === "findings") res = mockFindings;
              return Promise.resolve(res).then(onfulfilled);
            },
          }),
        };
      },
    }),
    insert: (table: Table) => ({
      values: (vals: unknown) => {
        const tableName = getTableName(table);
        const arr = Array.isArray(vals) ? vals : [vals];
        if (tableName === "findings") {
          for (const item of arr) {
            const raw = item as Record<string, unknown>;
            mockFindings.push({
              id: (raw.id as string) || `f-${mockFindings.length + 1}`,
              reviewId: raw.reviewId as string,
              kind: raw.kind as string,
              severity: raw.severity as string,
              confidence: raw.confidence as number,
              blockId: raw.blockId as string,
              startOffset: (raw.startOffset ?? raw.start ?? 0) as number,
              endOffset: (raw.endOffset ?? raw.end ?? 0) as number,
              matchedText: raw.matchedText as string,
              message: raw.message as string,
              sourceType: raw.sourceType as string,
              sourceCode: raw.sourceCode as string,
              sourceSnapshot: raw.sourceSnapshot as string,
              suggestion: (raw.suggestion as string | null) ?? null,
              state: (raw.state as string) ?? "open",
            });
          }
        } else if (tableName === "activity_log") {
          for (const item of arr) {
            mockActivityLog.push(item as { submissionId: string; action: string; detail: string });
          }
        }
        return {
          returning: async () => arr,
          then: (onfulfilled?: (val: unknown) => unknown) => Promise.resolve(arr).then(onfulfilled),
        };
      },
    }),
    update: (table: Table) => ({
      set: (updates: Record<string, unknown>) => ({
        where: () => {
          const tableName = getTableName(table);
          if (tableName === "reviews" && mockReviews.length > 0) {
            mockReviews[0] = { ...mockReviews[0], ...updates } as ReviewRow;
          }
          return {
            returning: async () => (mockReviews[0] ? [mockReviews[0]] : []),
            then: (onfulfilled?: (val: unknown) => unknown) =>
              Promise.resolve(mockReviews[0] ? [mockReviews[0]] : []).then(onfulfilled),
          };
        },
      }),
    }),
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AI_ENABLED = "true";
    process.env.AI_BASE_URL = "https://mock.api";
    process.env.AI_API_KEY = "test-secret-key";
    process.env.AI_MODEL = "test-model";
    process.env.EMBEDDING_MODEL = "test-embed";
    process.env.AI_MAX_RETRIES = "2";
    process.env.AI_RPM_LIMIT = "0";
    aiGuard.reset();

    const sampleDoc: NormalizedDocument = {
      version: 1,
      sourceKind: "text",
      title: "Sample",
      blocks: [
        { id: "b1", kind: "paragraph", text: "Every pouch is sourced from 50 estates." },
      ],
      images: [],
      stats: { chars: 39, blocks: 1, images: 0 },
    };

    const initialDisclosure: Disclosure = {
      promptVersion: "verity-deep-v2",
      fast: { ran: true, externalCalls: 0 },
      deep: {
        status: "running",
        provider: "openai-compatible",
        chatModel: "test-model",
        embeddingModel: "test-embed",
        externalCalls: 0,
        sentToExternal: "sentence-level excerpts only",
        retrieval: "none",
      },
      dropped: 0,
      verifiedClaims: [],
      log: ["Review started."],
    };

    mockReviews = [
      {
        id: "r-1",
        submissionId: "s-1",
        deepStatus: "running",
        startedAt: new Date(),
        score: 100,
        discardedCount: 0,
        disclosure: initialDisclosure,
      },
    ];

    mockSubmissions = [
      {
        id: "s-1",
        brandId: "brand-1",
        normalized: sampleDoc,
      },
    ];

    mockFindings = [];
    mockActivityLog = [];
    mockGuidelineSections = [
      { code: "GL-4.2", body: "Claims policy", category: "Claims" },
      { code: "GL-2.1", body: "Warm tone", category: "Voice" },
    ];
    mockApprovedClaims = [
      { code: "AC-1", text: "14 partner estates across Assam", brandId: "brand-1" },
    ];

    vi.spyOn(dbClientModule, "getDb").mockReturnValue(mockDb as unknown as ReturnType<typeof dbClientModule.getDb>);
    vi.spyOn(retrieveModule, "retrieveForSentence").mockImplementation(async () => ({
      claims: [{ code: "AC-1", text: "14 partner estates across Assam", similarity: 0.9 }],
      guidelines: [{ code: "GL-4.2", text: "Claims policy", similarity: 0.8 }],
      mode: "vector",
      externalCalls: 0,
    }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    aiGuard.reset();
    vi.restoreAllMocks();
  });

  it("quota -> failed, 1 fetch, fast intact, safe message in log, errorCode = quota_exceeded", async () => {
    let fetchCount = 0;
    const mockAdapter = {
      async embed() {
        fetchCount++;
        throw new AiError(
          "quota_exceeded",
          false,
          429,
          undefined,
          "Daily quota exceeded for project 123456",
        );
      },
      async complete() {
        fetchCount++;
        throw new AiError("quota_exceeded", false, 429);
      },
    };

    vi.spyOn(adapterModule, "getAdapter").mockReturnValue(mockAdapter as unknown as adapterModule.AiAdapter);

    await runDeep("r-1");

    const review = mockReviews[0];
    expect(review.deepStatus).toBe("failed");
    expect(review.disclosure.deep.status).toBe("failed");
    expect(review.disclosure.deep.errorCode).toBe("quota_exceeded");
    expect(review.disclosure.deep.errorMessage).toContain("quota is used up");
    expect(review.disclosure.deep.externalCalls).toBe(1);

    const logStr = (review.disclosure.log || []).join(" ");
    expect(logStr).not.toContain("Daily quota exceeded");
    expect(logStr).not.toContain("123456");
    expect(logStr).toContain("quota is used up");

    expect(review.score).toBeDefined();
    expect(mockActivityLog.some((a) => a.action === "deep_failed")).toBe(true);
    expect(fetchCount).toBe(1);
  });

  it("503 then OK -> done", async () => {
    let attempt = 0;
    const mockAdapter = {
      async embed(texts: string[]) {
        return {
          vectors: texts.map(() => new Array(1536).fill(0.1)),
          provider: "mock",
          model: "m",
          calls: 1,
        };
      },
      async complete(args: { system: string }) {
        attempt++;
        if (attempt === 1) {
          throw new AiError("provider_unavailable", true, 503);
        }
        if (args.system.includes("Voice guideline")) {
          return { data: { issues: [] }, provider: "mock", model: "m", ms: 20, calls: 1 };
        }
        return {
          data: {
            verdicts: [
              {
                index: 0,
                verdict: "not_a_claim",
                cited_source_code: null,
                confidence: 0.9,
                explanation: "test",
                suggested_rewrite: null,
              },
            ],
          },
          provider: "mock",
          model: "m",
          ms: 20,
          calls: 1,
        };
      },
    };

    vi.spyOn(adapterModule, "getAdapter").mockReturnValue(mockAdapter as unknown as adapterModule.AiAdapter);

    await runDeep("r-1");

    const review = mockReviews[0];
    expect(review.deepStatus).toBe("done");
    expect(review.disclosure.deep.status).toBe("done");
    expect(review.disclosure.deep.retries).toBe(1);
  });

  it("claims OK and tone fails -> claim findings kept, partial=true, counts preserved", async () => {
    const mockAdapter = {
      async embed(texts: string[]) {
        return {
          vectors: texts.map(() => new Array(1536).fill(0.1)),
          provider: "mock",
          model: "m",
          calls: 1,
        };
      },
      async complete(args: { system: string }) {
        if (args.system.includes("Voice guideline")) {
          throw new AiError("bad_request", false, 400);
        }
        return {
          data: {
            verdicts: [
              {
                index: 0,
                verdict: "contradicted",
                cited_source_code: "AC-1",
                confidence: 0.95,
                explanation: "Contradicts AC-1",
                suggested_rewrite: null,
              },
            ],
          },
          provider: "mock",
          model: "m",
          ms: 20,
          calls: 1,
        };
      },
    };

    vi.spyOn(adapterModule, "getAdapter").mockReturnValue(mockAdapter as unknown as adapterModule.AiAdapter);

    await runDeep("r-1");

    const review = mockReviews[0];
    expect(review.deepStatus).toBe("failed");
    expect(review.disclosure.deep.partial).toBe(true);
    expect(review.disclosure.deep.errorCode).toBe("bad_request");

    expect(mockFindings.length).toBeGreaterThan(0);
    expect(mockFindings[0].sourceCode).toBe("AC-1");
  });

  it("claims OK and tone reply is unreadable (invalid_output) -> finishes as done with partial: true and log line", async () => {
    const mockAdapter = {
      async embed(texts: string[]) {
        return {
          vectors: texts.map(() => new Array(1536).fill(0.1)),
          provider: "mock",
          model: "m",
          calls: 1,
        };
      },
      async complete(args: { system: string }) {
        if (args.system.includes("Voice guideline")) {
          throw new AiError("invalid_output", false);
        }
        return {
          data: {
            verdicts: [
              {
                index: 0,
                verdict: "contradicted",
                cited_source_code: "AC-1",
                confidence: 0.95,
                explanation: "Contradicts AC-1",
                suggested_rewrite: null,
              },
            ],
          },
          provider: "mock",
          model: "m",
          ms: 20,
          calls: 1,
        };
      },
    };

    vi.spyOn(adapterModule, "getAdapter").mockReturnValue(mockAdapter as unknown as adapterModule.AiAdapter);

    await runDeep("r-1");

    const review = mockReviews[0];
    expect(review.deepStatus).toBe("done");
    expect(review.disclosure.deep.status).toBe("done");
    expect(review.disclosure.deep.partial).toBe(true);
    expect(review.disclosure.log).toContain("Tone check skipped: the AI answer could not be read");
    expect(mockFindings.length).toBeGreaterThan(0);
    expect(mockFindings[0].sourceCode).toBe("AC-1");
  });

  it("stale running review is marked interrupted by latestReview", async () => {
    process.env.AI_DEEP_STALE_MS = "1000";
    const tenSecondsAgo = new Date(Date.now() - 10_000);

    mockReviews[0].deepStatus = "running";
    mockReviews[0].startedAt = tenSecondsAgo;

    const res = await latestReview("s-1");

    expect(res).toBeDefined();
    expect(res?.deepStatus).toBe("failed");
    expect(res?.disclosure.deep.errorCode).toBe("interrupted");
    expect(res?.disclosure.deep.errorMessage).toContain("interrupted");
    expect(mockActivityLog.some((a) => a.action === "deep_failed")).toBe(true);
  });
});
