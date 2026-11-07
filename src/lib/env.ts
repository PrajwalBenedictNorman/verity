import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  AI_ENABLED: z.string().default("true"),
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_FALLBACK_MODEL: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIM: z.coerce.number().default(1536),
  AI_TIMEOUT_MS: z.coerce.number().default(30_000),
  AI_MAX_RETRIES: z.coerce.number().default(2),
  AI_MAX_CONCURRENCY: z.coerce.number().default(2),
  AI_RPM_LIMIT: z.coerce.number().default(10),
  AI_BREAKER_COOLDOWN_MS: z.coerce.number().default(300_000),
  AI_CLAIM_BATCH_SIZE: z.coerce.number().default(6),
  AI_TONE_CHUNK_CHARS: z.coerce.number().default(6000),
  EMBED_BATCH_SIZE: z.coerce.number().default(32),
  AI_DEEP_BUDGET_MS: z.coerce.number().default(120_000),
  AI_DEEP_STALE_MS: z.coerce.number().default(300_000),
  AI_CACHE_TTL_DAYS: z.coerce.number().default(7),
  RETRIEVAL_MIN_SIM: z.coerce.number().default(0.3),
  STORAGE_DIR: z.string().default("./storage"),
  ENABLE_VISION: z.string().default("false"),
});

export type Env = z.infer<typeof envSchema>;

let validatedEnv: Env | null = null;

export function getEnv(): Env {
  if (!validatedEnv) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      console.warn("Invalid environment configuration:", parsed.error.format());
      validatedEnv = envSchema.parse({});
    } else {
      validatedEnv = parsed.data;
    }

    if (validatedEnv.AI_ENABLED !== "false") {
      const missing: string[] = [];
      if (!validatedEnv.AI_BASE_URL) missing.push("AI_BASE_URL");
      if (!validatedEnv.AI_API_KEY) missing.push("AI_API_KEY");
      if (!validatedEnv.AI_MODEL) missing.push("AI_MODEL");
      if (missing.length > 0) {
        console.warn(
          `AI is enabled (AI_ENABLED!=false) but required variables are missing: ${missing.join(", ")}. Deep tier will run fast-only.`,
        );
      }
    }
  }
  return validatedEnv;
}
