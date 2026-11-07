import { describe, expect, it, vi } from "vitest";
import { AiError } from "@/server/ai/errors";
import { withRetries } from "@/server/review/deep/retry";
import type { DeepStats } from "@/server/review/deep/stats";

describe("Single retry layer with withRetries", () => {
  it("503 then 200 succeeds", async () => {
    vi.useFakeTimers();
    try {
      const ctx: DeepStats = { calls: 0, retries: 0, cacheHits: 0 };
      let attempt = 0;
      const fn = vi.fn().mockImplementation(async () => {
        attempt++;
        if (attempt === 1) {
          throw new AiError("provider_unavailable", true, 503);
        }
        return "success";
      });

      const promise = withRetries(fn, { ctx, baseMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
      expect(ctx.calls).toBe(2);
      expect(ctx.retries).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("daily-quota 429 makes exactly 1 call and throws immediately", async () => {
    const ctx: DeepStats = { calls: 0, retries: 0, cacheHits: 0 };
    const fn = vi.fn().mockImplementation(async () => {
      throw new AiError("quota_exceeded", false, 429);
    });

    await expect(withRetries(fn, { ctx })).rejects.toThrow(AiError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ctx.calls).toBe(1);
    expect(ctx.retries).toBe(0);
  });

  it("404 model_not_found never retries", async () => {
    const ctx: DeepStats = { calls: 0, retries: 0, cacheHits: 0 };
    const fn = vi.fn().mockImplementation(async () => {
      throw new AiError("model_not_found", false, 404);
    });

    await expect(withRetries(fn, { ctx })).rejects.toThrow(AiError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ctx.calls).toBe(1);
    expect(ctx.retries).toBe(0);
  });

  it("Retry-After: 2 waits at least 2 s before retrying", async () => {
    vi.useFakeTimers();
    try {
      let attempt = 0;
      const fn = vi.fn().mockImplementation(async () => {
        attempt++;
        if (attempt === 1) {
          throw new AiError("rate_limited", true, 429, 2000);
        }
        return "ok";
      });

      const promise = withRetries(fn, { maxWaitMs: 5000 });
      // Advance by 1000ms: should not have resolved yet
      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledTimes(1);

      // Advance by another 1000ms: now 2000ms reached
      await vi.advanceTimersByTimeAsync(1000);
      const res = await promise;
      expect(res).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Retry-After: 120 fails fast when maxWaitMs is 20s", async () => {
    const ctx: DeepStats = { calls: 0, retries: 0, cacheHits: 0 };
    const fn = vi.fn().mockImplementation(async () => {
      throw new AiError("rate_limited", true, 429, 120_000);
    });

    await expect(withRetries(fn, { ctx, maxWaitMs: 20_000 })).rejects.toThrow(AiError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ctx.calls).toBe(1);
    expect(ctx.retries).toBe(0);
  });

  it("timeout is retried at most once", async () => {
    vi.useFakeTimers();
    try {
      const ctx: DeepStats = { calls: 0, retries: 0, cacheHits: 0 };
      const fn = vi.fn().mockImplementation(async () => {
        throw new AiError("timeout", true);
      });

      const promise = withRetries(fn, { ctx, retries: 3, baseMs: 100 });
      const caughtPromise = promise.catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await caughtPromise;

      expect(err).toBeInstanceOf(AiError);
      expect(fn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry = 2 attempts
      expect(ctx.calls).toBe(2);
      expect(ctx.retries).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
