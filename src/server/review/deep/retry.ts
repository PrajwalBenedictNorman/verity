import { AiError } from "@/server/ai/errors";
import type { DeepStats } from "./stats";

export type RetryOptions = {
  ctx?: DeepStats;
  retries?: number;
  baseMs?: number;
  maxWaitMs?: number;
};

const NON_RETRYABLE_CODES = new Set([
  "quota_exceeded",
  "auth",
  "model_not_found",
  "bad_request",
  "invalid_output",
  "breaker_open",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: RetryOptions | number = {},
): Promise<T> {
  const options: RetryOptions =
    typeof opts === "number" ? { retries: opts } : opts;

  const baseMs = options.baseMs ?? 1000;
  const maxWaitMs = options.maxWaitMs ?? 20_000;
  const maxRetries =
    options.retries ?? Number(process.env.AI_MAX_RETRIES ?? 2);

  let attempt = 0;
  while (true) {
    if (options.ctx) {
      options.ctx.calls += 1;
    }

    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof AiError) || !err.retryable) {
        throw err;
      }

      if (NON_RETRYABLE_CODES.has(err.code)) {
        throw err;
      }

      // timeout is retried at most once
      if (err.code === "timeout" && attempt >= 1) {
        throw err;
      }

      if (attempt >= maxRetries) {
        throw err;
      }

      let delayMs: number;
      if (err.retryAfterMs !== undefined) {
        if (err.retryAfterMs > maxWaitMs) {
          throw err;
        }
        delayMs = err.retryAfterMs;
      } else {
        const cap = Math.min(15_000, baseMs * 2 ** attempt);
        delayMs = Math.floor(Math.random() * cap);
      }

      if (options.ctx) {
        options.ctx.retries += 1;
      }

      attempt += 1;
      await sleep(delayMs);
    }
  }
}
