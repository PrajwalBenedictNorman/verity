const userReviewTimestamps = new Map<string, number[]>();

export function checkUserReviewRateLimit(
  userId: string,
  limit = 10,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
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
