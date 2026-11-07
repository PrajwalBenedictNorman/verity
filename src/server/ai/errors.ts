export type AiErrorCode =
  | "quota_exceeded" // 429 daily/monthly or limit 0. Do NOT retry.
  | "rate_limited" // 429 per-minute. Retry only if the wait is short.
  | "provider_unavailable" // 500/502/503/504. Retry with backoff.
  | "timeout" // AbortError/TimeoutError. Retry once.
  | "network" // fetch failed. Retry.
  | "model_not_found" // 404. Config problem. No retry.
  | "auth" // 401/403. Config problem. No retry.
  | "bad_request" // 400 after the JSON-mode fallback. No retry.
  | "invalid_output" // JSON did not match the schema after one repair.
  | "breaker_open" // short-circuited locally, no HTTP made
  | "unknown";

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    public retryable: boolean,
    public status?: number,
    public retryAfterMs?: number,
    public providerBody?: string, // server logs only. Truncated to 500 chars and redacted.
  ) {
    super(`AI request failed (${code}${status ? ` ${status}` : ""})`); // SAFE message, no body
    this.name = "AiError";
  }
}

export function userMessageFor(code: AiErrorCode | "interrupted" | string): string {
  if (code === "interrupted") {
    return "Deep checks were interrupted. Fast results are shown.";
  }
  switch (code) {
    case "quota_exceeded":
      return "The AI provider's usage quota is used up. Fast results are shown. Try again later or use another model or key.";
    case "rate_limited":
      return "The AI provider is rate limiting requests. Fast results are shown.";
    case "provider_unavailable":
      return "The AI provider is temporarily unavailable. Fast results are shown.";
    case "timeout":
    case "network":
      return "The AI provider could not be reached in time. Fast results are shown.";
    case "model_not_found":
      return "The configured AI model was not found. An admin should check AI_MODEL.";
    case "auth":
      return "The AI provider rejected the credentials. An admin should check AI_API_KEY.";
    case "breaker_open":
      return "AI checks are paused after repeated provider errors. Fast results are shown.";
    default:
      return "Deep checks could not complete. Fast results are shown.";
  }
}

export function redact(s: string): string {
  if (!s) return "";
  let out = s;
  const envKey = process.env.AI_API_KEY;
  if (envKey && envKey.length > 4) {
    out = out.split(envKey).join("[REDACTED_API_KEY]");
  }
  return out
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, "AIza...[REDACTED]")
    .replace(/sk-[a-zA-Z0-9_\-]{20,}/g, "sk-...[REDACTED]")
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, "Bearer [REDACTED]")
    .replace(/(?:key|api[-_]?key)=([a-zA-Z0-9_\-]+)/gi, "key=[REDACTED]");
}

export function classifyHttpError(
  status: number,
  body: string,
  headers?: Headers | Record<string, string>,
): AiError {
  const getHeader = (name: string): string | null => {
    if (!headers) return null;
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name);
    }
    const record = headers as Record<string, string>;
    const lower = name.toLowerCase();
    for (const k of Object.keys(record)) {
      if (k.toLowerCase() === lower) return record[k];
    }
    return null;
  };

  const truncatedRedactedBody = redact(body.slice(0, 500));

  if (status === 429) {
    const isDailyQuota =
      /per.?day|daily|limit:\s*0|billing|check your plan/i.test(body) &&
      !/per.?minute/i.test(body);

    if (isDailyQuota) {
      return new AiError(
        "quota_exceeded",
        false,
        status,
        undefined,
        truncatedRedactedBody,
      );
    }

    let retryAfterMs: number | undefined;
    const retryAfterHeader = getHeader("retry-after");
    if (retryAfterHeader) {
      const seconds = Number(retryAfterHeader);
      if (!Number.isNaN(seconds)) {
        retryAfterMs = seconds * 1000;
      } else {
        const dateMs = Date.parse(retryAfterHeader);
        if (!Number.isNaN(dateMs)) {
          retryAfterMs = Math.max(0, dateMs - Date.now());
        }
      }
    }
    if (retryAfterMs === undefined && body) {
      const match =
        body.match(/retryDelay["':\s]+"?(\d+(?:\.\d+)?)(m?s)?"?/i) ||
        body.match(/retry\s+after\s+(\d+(?:\.\d+)?)(m?s)?/i);
      if (match) {
        const val = parseFloat(match[1]);
        const unit = match[2]?.toLowerCase();
        retryAfterMs = unit === "ms" ? val : val * 1000;
      }
    }

    return new AiError(
      "rate_limited",
      true,
      status,
      retryAfterMs,
      truncatedRedactedBody,
    );
  }

  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return new AiError(
      "provider_unavailable",
      true,
      status,
      undefined,
      truncatedRedactedBody,
    );
  }

  if (status === 404) {
    return new AiError(
      "model_not_found",
      false,
      status,
      undefined,
      truncatedRedactedBody,
    );
  }

  if (status === 401 || status === 403) {
    return new AiError("auth", false, status, undefined, truncatedRedactedBody);
  }

  if (status === 400) {
    return new AiError(
      "bad_request",
      false,
      status,
      undefined,
      truncatedRedactedBody,
    );
  }

  if (status === 408) {
    return new AiError(
      "timeout",
      true,
      status,
      undefined,
      truncatedRedactedBody,
    );
  }

  return new AiError(
    "unknown",
    false,
    status,
    undefined,
    truncatedRedactedBody,
  );
}

export function classifyError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof Error) {
    if (
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      /timeout|timed out/i.test(err.message)
    ) {
      return new AiError(
        "timeout",
        true,
        undefined,
        undefined,
        redact(err.message.slice(0, 500)),
      );
    }
    if (
      (err instanceof TypeError && /fetch failed/i.test(err.message)) ||
      /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|network/i.test(err.message)
    ) {
      return new AiError(
        "network",
        true,
        undefined,
        undefined,
        redact(err.message.slice(0, 500)),
      );
    }
    return new AiError(
      "unknown",
      false,
      undefined,
      undefined,
      redact(err.message.slice(0, 500)),
    );
  }
  return new AiError(
    "unknown",
    false,
    undefined,
    undefined,
    redact(String(err).slice(0, 500)),
  );
}
