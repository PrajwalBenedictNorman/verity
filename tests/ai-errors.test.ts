import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import {
  AiError,
  classifyError,
  classifyHttpError,
  redact,
  userMessageFor,
} from "@/server/ai/errors";
import { createOpenAiCompatibleAdapter, getAdapter } from "@/server/ai/openai-compatible";

describe("AI error handling and classification", () => {
  it("redacts API keys and Bearer tokens", () => {
    const raw =
      "Error with key AIzaSyA1234567890123456789012345678901 and sk-abcdef1234567890abcdef1234567890 and Bearer secret-token-xyz";
    const cleaned = redact(raw);
    expect(cleaned).not.toContain("AIzaSyA1234567890123456789012345678901");
    expect(cleaned).not.toContain("sk-abcdef1234567890abcdef1234567890");
    expect(cleaned).not.toContain("secret-token-xyz");
    expect(cleaned).toContain("AIza...[REDACTED]");
    expect(cleaned).toContain("sk-...[REDACTED]");
    expect(cleaned).toContain("Bearer [REDACTED]");
  });

  it("redacts process.env.AI_API_KEY if present", () => {
    const original = process.env.AI_API_KEY;
    try {
      process.env.AI_API_KEY = "super-secret-key-12345";
      const raw = "Request failed for key=super-secret-key-12345 in header";
      const cleaned = redact(raw);
      expect(cleaned).not.toContain("super-secret-key-12345");
      expect(cleaned).toContain("[REDACTED_API_KEY]");
    } finally {
      process.env.AI_API_KEY = original;
    }
  });

  it("classifies 429 quota exceeded (daily/monthly/billing)", () => {
    const err = classifyHttpError(
      429,
      JSON.stringify({
        error: { message: "Quota exceeded: check your plan and billing details. limit: 0 per day" },
      }),
    );
    expect(err.code).toBe("quota_exceeded");
    expect(err.retryable).toBe(false);
    expect(err.message).toBe("AI request failed (quota_exceeded 429)");
    expect(err.message).not.toContain("billing");
  });

  it("classifies 429 rate limited with Retry-After header (seconds)", () => {
    const headers = new Headers({ "retry-after": "5" });
    const err = classifyHttpError(
      429,
      JSON.stringify({ error: { message: "Too many requests per minute" } }),
      headers,
    );
    expect(err.code).toBe("rate_limited");
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(5000);
  });

  it("classifies 429 rate limited with retryDelay body hint", () => {
    const err = classifyHttpError(
      429,
      JSON.stringify({
        error: { message: "Resource exhausted. Please retry after 34s", retryDelay: "34s" },
      }),
    );
    expect(err.code).toBe("rate_limited");
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(34000);
  });

  it("classifies 500, 502, 503, 504 as provider_unavailable (retryable)", () => {
    for (const status of [500, 502, 503, 504]) {
      const err = classifyHttpError(status, "Service Unavailable");
      expect(err.code).toBe("provider_unavailable");
      expect(err.retryable).toBe(true);
      expect(err.status).toBe(status);
    }
  });

  it("classifies 404 as model_not_found (not retryable)", () => {
    const err = classifyHttpError(404, "models/gemini-old is not found");
    expect(err.code).toBe("model_not_found");
    expect(err.retryable).toBe(false);
  });

  it("classifies 401 and 403 as auth (not retryable)", () => {
    for (const status of [401, 403]) {
      const err = classifyHttpError(status, "API key invalid");
      expect(err.code).toBe("auth");
      expect(err.retryable).toBe(false);
    }
  });

  it("classifies 400 as bad_request (not retryable)", () => {
    const err = classifyHttpError(400, "Invalid parameter");
    expect(err.code).toBe("bad_request");
    expect(err.retryable).toBe(false);
  });

  it("classifies timeout and network errors", () => {
    const timeoutErr = new Error("The operation was aborted due to timeout");
    timeoutErr.name = "TimeoutError";
    const classifiedTimeout = classifyError(timeoutErr);
    expect(classifiedTimeout.code).toBe("timeout");
    expect(classifiedTimeout.retryable).toBe(true);

    const netErr = new TypeError("fetch failed: ECONNREFUSED");
    const classifiedNet = classifyError(netErr);
    expect(classifiedNet.code).toBe("network");
    expect(classifiedNet.retryable).toBe(true);
  });

  it("returns safe user-facing messages without leaking details", () => {
    expect(userMessageFor("quota_exceeded")).toContain("quota is used up");
    expect(userMessageFor("rate_limited")).toContain("rate limiting requests");
    expect(userMessageFor("provider_unavailable")).toContain("temporarily unavailable");
    expect(userMessageFor("timeout")).toContain("could not be reached in time");
    expect(userMessageFor("network")).toContain("could not be reached in time");
    expect(userMessageFor("model_not_found")).toContain("AI_MODEL");
    expect(userMessageFor("auth")).toContain("AI_API_KEY");
    expect(userMessageFor("breaker_open")).toContain("checks are paused");
    expect(userMessageFor("unknown")).toContain("Deep checks could not complete");
  });
});

describe("Clean adapter and single-layer behavior", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AI_BASE_URL = "https://mock.ai/v1";
    process.env.AI_API_KEY = "test-key-mock";
    process.env.AI_MODEL = "test-model";
    process.env.EMBEDDING_MODEL = "test-embed";
    process.env.EMBEDDING_DIM = "1536";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("adapter does not retry internally on 503 or 429; throws AiError with calls=1", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return new Response("Service Unavailable", { status: 503 });
    });

    const adapter = createOpenAiCompatibleAdapter();
    await expect(
      adapter.complete({
        system: "sys",
        user: "usr",
        schema: z.object({ ok: z.boolean() }),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(AiError);

    // Exactly 1 fetch call: no internal retry loop!
    expect(fetchCount).toBe(1);
  });

  it("adapter handles JSON mode fallback on 400 and increments calls count", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      fetchCount++;
      const body = JSON.parse(opts.body as string);
      if (body.response_format) {
        return new Response("response_format not supported", { status: 400 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        }),
        { status: 200 },
      );
    });

    const adapter = createOpenAiCompatibleAdapter();
    const result = await adapter.complete({
      system: "sys",
      user: "usr",
      schema: z.object({ ok: z.boolean() }),
      timeoutMs: 5000,
    });

    expect(fetchCount).toBe(2);
    expect(result.calls).toBe(2);
    expect(result.data).toEqual({ ok: true });
  });

  it("adapter retries once for schema repair with invalid output included", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      fetchCount++;
      const body = JSON.parse(opts.body as string);
      if (fetchCount === 1) {
        // First attempt returns invalid schema
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ wrong: "data" }) } }],
          }),
          { status: 200 },
        );
      }
      // Verify repair prompt includes the issue
      const userPrompt = body.messages[body.messages.length - 1].content;
      expect(userPrompt).toContain("did not match the schema");
      expect(userPrompt).toContain("wrong");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        }),
        { status: 200 },
      );
    });

    const adapter = createOpenAiCompatibleAdapter();
    const result = await adapter.complete({
      system: "sys",
      user: "usr",
      schema: z.object({ ok: z.boolean() }),
      timeoutMs: 5000,
    });

    expect(fetchCount).toBe(2);
    expect(result.calls).toBe(2);
    expect(result.data).toEqual({ ok: true });
  });

  it("adapter embed sends dimensions and falls back if 400 is returned", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      fetchCount++;
      const body = JSON.parse(opts.body as string);
      if (body.dimensions) {
        return new Response("dimensions unsupported", { status: 400 });
      }
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: new Array(1536).fill(0.1) }],
        }),
        { status: 200 },
      );
    });

    const adapter = createOpenAiCompatibleAdapter();
    const result = await adapter.embed(["test text"]);
    expect(fetchCount).toBe(2);
    expect(result.calls).toBe(2);
    expect(result.vectors).toHaveLength(1);
    expect(result.vectors[0]).toHaveLength(1536);
  });

  it("getAdapter returns cached singleton unless env changes", () => {
    const a1 = getAdapter();
    const a2 = getAdapter();
    expect(a1).toBe(a2);

    process.env.AI_MODEL = "different-model";
    const a3 = getAdapter();
    expect(a3).not.toBe(a1);
  });
});
