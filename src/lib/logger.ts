import { redact } from "@/server/ai/errors";

export interface LogContext {
  reviewId?: string;
  [key: string]: unknown;
}

export class Logger {
  constructor(private context: LogContext = {}) {}

  with(ctx: LogContext): Logger {
    return new Logger({ ...this.context, ...ctx });
  }

  private format(level: string, message: string, data?: unknown) {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message: redact(message),
      ...this.context,
    };
    if (data !== undefined) {
      if (typeof data === "object" && data !== null) {
        entry.data = JSON.parse(redact(JSON.stringify(data)));
      } else {
        entry.data = redact(String(data));
      }
    }
    return entry;
  }

  info(message: string, data?: unknown): void {
    console.log(JSON.stringify(this.format("info", message, data)));
  }

  warn(message: string, data?: unknown): void {
    console.warn(JSON.stringify(this.format("warn", message, data)));
  }

  error(message: string, data?: unknown): void {
    console.error(JSON.stringify(this.format("error", message, data)));
  }

  deepSummary(stats: {
    ms: number;
    calls: number;
    retries: number;
    cacheHits: number;
    dropped: number;
  }): void {
    console.log(
      `deep done ms=${stats.ms} calls=${stats.calls} retries=${stats.retries} cacheHits=${stats.cacheHits} dropped=${stats.dropped}`,
    );
  }
}

export const logger = new Logger();
