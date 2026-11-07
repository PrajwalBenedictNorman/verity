import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AiError } from "@/server/ai/errors";
import { aiGuard } from "@/server/ai/guard";

describe("aiGuard concurrency, RPM, breaker, and state", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AI_BASE_URL = "https://mock.api/v1";
    process.env.AI_MODEL = "test-model";
    process.env.EMBEDDING_MODEL = "test-embed";
    aiGuard.reset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    aiGuard.reset();
    vi.restoreAllMocks();
  });

  it("concurrency: with AI_MAX_CONCURRENCY=2, never sees more than 2 in flight", async () => {
    process.env.AI_MAX_CONCURRENCY = "2";
    process.env.AI_RPM_LIMIT = "0"; // disable RPM limiter for pure concurrency test
    let inFlight = 0;
    let maxInFlight = 0;

    const tasks = Array.from({ length: 20 }, async () => {
      return aiGuard.run("chat", async () => {
        inFlight++;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return true;
      });
    });

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(20);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(aiGuard.getInFlight()).toBe(0);
  });

  it("RPM limiter: with AI_RPM_LIMIT=10, the 11th call waits for a token", async () => {
    vi.useFakeTimers();
    try {
      process.env.AI_MAX_CONCURRENCY = "20"; // so concurrency doesn't gate
      process.env.AI_RPM_LIMIT = "10";

      let completed = 0;
      for (let i = 0; i < 11; i++) {
        void aiGuard.run("chat", async () => {
          completed++;
        });
      }

      // First 10 tokens are available immediately (bucket capacity = 10)
      await vi.advanceTimersByTimeAsync(0);
      expect(completed).toBe(10);

      // The 11th call should still be waiting
      expect(completed).toBe(10);

      // Advance by 6 seconds (1 token refills: 10 / 60s = 1 token per 6s)
      await vi.advanceTimersByTimeAsync(6000);
      expect(completed).toBe(11);
    } finally {
      vi.useRealTimers();
    }
  });

  it("breaker: after one quota_exceeded, next 5 calls throw breaker_open with zero executions", async () => {
    let callCount = 0;
    const failingCall = async () => {
      return aiGuard.run("chat", async () => {
        callCount++;
        throw new AiError("quota_exceeded", false, 429);
      });
    };

    await expect(failingCall()).rejects.toThrow(AiError);
    expect(callCount).toBe(1);

    expect(aiGuard.state().breaker).toBe("open");
    expect(aiGuard.state().reopensAt).toBeDefined();

    // Next 5 calls throw breaker_open immediately without executing callback
    for (let i = 0; i < 5; i++) {
      await expect(
        aiGuard.run("chat", async () => {
          callCount++;
        }),
      ).rejects.toMatchObject({
        code: "breaker_open",
      });
    }

    // Still exactly 1 call was executed
    expect(callCount).toBe(1);
  });

  it("breaker: 3 consecutive provider_unavailable errors open the breaker for 60s", async () => {
    let callCount = 0;
    const transientFail = async () => {
      return aiGuard.run("chat", async () => {
        callCount++;
        throw new AiError("provider_unavailable", true, 503);
      });
    };

    // Attempt 1
    await expect(transientFail()).rejects.toThrow(AiError);
    expect(aiGuard.state().breaker).toBe("closed");

    // Attempt 2
    await expect(transientFail()).rejects.toThrow(AiError);
    expect(aiGuard.state().breaker).toBe("closed");

    // Attempt 3: trips the breaker
    await expect(transientFail()).rejects.toThrow(AiError);
    expect(aiGuard.state().breaker).toBe("open");

    // Next call is blocked
    await expect(
      aiGuard.run("chat", async () => {
        callCount++;
      }),
    ).rejects.toMatchObject({
      code: "breaker_open",
    });
    expect(callCount).toBe(3);
  });

  it("breaker: a success closes the breaker", async () => {
    // Cause 2 transient errors
    for (let i = 0; i < 2; i++) {
      try {
        await aiGuard.run("chat", async () => {
          throw new AiError("provider_unavailable", true, 503);
        });
      } catch {
        // ignore
      }
    }
    // A success resets consecutive count
    await aiGuard.run("chat", async () => "ok");

    // Another transient error does not trip it
    try {
      await aiGuard.run("chat", async () => {
        throw new AiError("provider_unavailable", true, 503);
      });
    } catch {
      // ignore
    }
    expect(aiGuard.state().breaker).toBe("closed");
  });
});
