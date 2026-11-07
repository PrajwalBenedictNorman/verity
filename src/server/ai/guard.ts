import { AiError } from "./errors";

export type GuardState = {
  breaker: "closed" | "open";
  reopensAt?: string;
};

type BreakerEntry = {
  state: "closed" | "open" | "half-open";
  openedAt?: number;
  cooldownMs?: number;
  consecutiveTransientErrors: number;
};

class ConcurrencyLimiter {
  private inFlight = 0;
  private queue: (() => void)[] = [];

  private getMax() {
    const val = Number(process.env.AI_MAX_CONCURRENCY ?? 2);
    return Number.isNaN(val) || val < 1 ? 2 : val;
  }

  async acquire(): Promise<void> {
    const max = this.getMax();
    if (this.inFlight < max) {
      this.inFlight++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.inFlight++;
        resolve();
      });
    });
  }

  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    }
  }

  getInFlight(): number {
    return this.inFlight;
  }

  reset(): void {
    this.inFlight = 0;
    this.queue = [];
  }
}

class RpmLimiter {
  private queue: (() => void)[] = [];
  private tokens: number | null = null;
  private lastRefill: number = Date.now();
  private timer: ReturnType<typeof setTimeout> | null = null;

  private getLimit() {
    const limit = Number(process.env.AI_RPM_LIMIT ?? 10);
    return Number.isNaN(limit) ? 10 : limit;
  }

  async acquire(): Promise<void> {
    const limit = this.getLimit();
    if (limit <= 0) return;

    if (this.tokens === null) {
      this.tokens = limit;
      this.lastRefill = Date.now();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.processQueue();
    });
  }

  private processQueue() {
    const limit = this.getLimit();
    if (limit <= 0) {
      while (this.queue.length > 0) {
        this.queue.shift()!();
      }
      return;
    }

    if (this.queue.length === 0) return;

    const now = Date.now();
    if (this.tokens === null) {
      this.tokens = limit;
      this.lastRefill = now;
    } else {
      const elapsed = Math.max(0, now - this.lastRefill);
      this.tokens = Math.min(limit, this.tokens + elapsed * (limit / 60_000));
      this.lastRefill = now;
    }

    if (this.tokens >= 1) {
      this.tokens -= 1;
      const next = this.queue.shift();
      next?.();
      if (this.queue.length > 0) {
        this.processQueue();
      }
    } else {
      if (this.timer) return;
      const waitMs = Math.ceil((1 - this.tokens) / (limit / 60_000));
      this.timer = setTimeout(() => {
        this.timer = null;
        this.processQueue();
      }, Math.max(1, waitMs));
    }
  }

  reset(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue = [];
    this.tokens = null;
    this.lastRefill = Date.now();
  }
}

class CircuitBreaker {
  private breakers = new Map<string, BreakerEntry>();

  private getCooldown() {
    const val = Number(process.env.AI_BREAKER_COOLDOWN_MS ?? 300_000);
    return Number.isNaN(val) ? 300_000 : val;
  }

  private getKey(kind: "chat" | "embed") {
    const base = (process.env.AI_BASE_URL ?? "").replace(/\/$/, "");
    const model =
      kind === "chat"
        ? (process.env.AI_MODEL ?? "")
        : (process.env.EMBEDDING_MODEL ?? "");
    return `${base}|${model}`;
  }

  check(kind: "chat" | "embed"): void {
    const key = this.getKey(kind);
    const entry = this.breakers.get(key);
    if (!entry || entry.state === "closed") return;

    const now = Date.now();
    const cooldown = entry.cooldownMs ?? this.getCooldown();
    if (entry.openedAt && now - entry.openedAt >= cooldown) {
      // Allow one probe call
      entry.state = "half-open";
      return;
    }

    throw new AiError("breaker_open", false, undefined, undefined, "Circuit breaker is open");
  }

  recordSuccess(kind: "chat" | "embed"): void {
    const key = this.getKey(kind);
    const entry = this.breakers.get(key);
    if (entry) {
      entry.state = "closed";
      entry.consecutiveTransientErrors = 0;
      entry.openedAt = undefined;
      entry.cooldownMs = undefined;
    }
  }

  recordError(kind: "chat" | "embed", err: unknown): void {
    if (!(err instanceof AiError)) return;
    const key = this.getKey(kind);
    let entry = this.breakers.get(key);
    if (!entry) {
      entry = {
        state: "closed",
        consecutiveTransientErrors: 0,
      };
      this.breakers.set(key, entry);
    }

    if (
      err.code === "quota_exceeded" ||
      err.code === "auth" ||
      err.code === "model_not_found"
    ) {
      entry.state = "open";
      entry.openedAt = Date.now();
      entry.cooldownMs = this.getCooldown();
      return;
    }

    if (err.code === "provider_unavailable" || err.code === "rate_limited") {
      entry.consecutiveTransientErrors += 1;
      if (entry.consecutiveTransientErrors >= 3 || entry.state === "half-open") {
        entry.state = "open";
        entry.openedAt = Date.now();
        entry.cooldownMs = 60_000; // 60s for transient errors
      }
    }
  }

  state(): GuardState {
    const now = Date.now();
    for (const entry of this.breakers.values()) {
      if (entry.state === "open" && entry.openedAt) {
        const cooldown = entry.cooldownMs ?? this.getCooldown();
        if (now - entry.openedAt < cooldown) {
          return {
            breaker: "open",
            reopensAt: new Date(entry.openedAt + cooldown).toISOString(),
          };
        }
      }
    }
    return { breaker: "closed" };
  }

  reset(): void {
    this.breakers.clear();
  }
}

const concurrencyLimiter = new ConcurrencyLimiter();
const rpmLimiter = new RpmLimiter();
const circuitBreaker = new CircuitBreaker();

export const aiGuard = {
  async run<T>(kind: "chat" | "embed", fn: () => Promise<T>): Promise<T> {
    // 1. Fast check: if breaker is open, fail immediately without queueing
    circuitBreaker.check(kind);

    // 2. RPM token bucket wait
    await rpmLimiter.acquire();

    // 3. Concurrency limit wait
    await concurrencyLimiter.acquire();

    try {
      // 4. Re-check breaker after queuing in case another call tripped it
      circuitBreaker.check(kind);

      const result = await fn();
      circuitBreaker.recordSuccess(kind);
      return result;
    } catch (err) {
      circuitBreaker.recordError(kind, err);
      throw err;
    } finally {
      concurrencyLimiter.release();
    }
  },

  state(): GuardState {
    return circuitBreaker.state();
  },

  reset(): void {
    concurrencyLimiter.reset();
    rpmLimiter.reset();
    circuitBreaker.reset();
  },

  getInFlight(): number {
    return concurrencyLimiter.getInFlight();
  },
};
