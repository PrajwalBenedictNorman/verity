const userReviewTimestamps = new Map<string, number[]>();
export const MAX_RATE_LIMIT_ENTRIES = 10_000;

/**
 * Prune all expired timestamps across the rate limit map.
 */
export function pruneExpiredRateLimits(now = Date.now(), windowMs = 60_000): void {
  for (const [userId, timestamps] of userReviewTimestamps.entries()) {
    const valid = timestamps.filter((t) => now - t < windowMs);
    if (valid.length === 0) {
      userReviewTimestamps.delete(userId);
    } else if (valid.length < timestamps.length) {
      userReviewTimestamps.set(userId, valid);
    }
  }
}

/**
 * Per-process in-memory rate limiter for review actions.
 */
export function checkUserReviewRateLimit(
  userId: string,
  limit = 10,
  windowMs = 60_000,
): boolean {
  const now = Date.now();

  // If map grows beyond capacity, prune expired entries to prevent memory leak
  if (userReviewTimestamps.size >= MAX_RATE_LIMIT_ENTRIES) {
    pruneExpiredRateLimits(now, windowMs);
    // If still over capacity after pruning, evict the oldest key
    while (userReviewTimestamps.size >= MAX_RATE_LIMIT_ENTRIES) {
      const oldestKey = userReviewTimestamps.keys().next().value;
      if (oldestKey) {
        userReviewTimestamps.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  const timestamps = userReviewTimestamps.get(userId) ?? [];
  const valid = timestamps.filter((t) => now - t < windowMs);

  if (valid.length >= limit) {
    userReviewTimestamps.set(userId, valid);
    return false;
  }

  valid.push(now);
  userReviewTimestamps.set(userId, valid);
  return true;
}

export function resetRateLimits(): void {
  userReviewTimestamps.clear();
}

export function getRateLimitMapSize(): number {
  return userReviewTimestamps.size;
}
