import { describe, expect, it, beforeEach } from "vitest";
import {
  checkUserReviewRateLimit,
  resetRateLimits,
  getRateLimitMapSize,
} from "@/lib/rate-limit";

describe("rate limiter pruning and eviction", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("prunes expired timestamps and evicts empty entries", () => {
    // Call for user-1
    checkUserReviewRateLimit("user-1", 5, 100);
    expect(getRateLimitMapSize()).toBe(1);

    // Wait for window to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Checking for user-2 should prune or when user-1 is checked again after expiry
        const allowed = checkUserReviewRateLimit("user-1", 5, 100);
        expect(allowed).toBe(true);
        // Only 1 entry exists
        expect(getRateLimitMapSize()).toBe(1);
        resolve();
      }, 120);
    });
  });

  it("enforces maximum map size cap", () => {
    // Add 10,005 entries
    for (let i = 0; i < 10050; i++) {
      checkUserReviewRateLimit(`user-${i}`, 10, 60_000);
    }
    // Size should be capped at MAX_ENTRIES (10000)
    expect(getRateLimitMapSize()).toBeLessThanOrEqual(10000);
  });
});
