import type { z } from "zod";
export { getAdapter } from "./openai-compatible";

export type AiCompleteResult = {
  data: unknown;
  provider: string;
  model: string;
  ms: number;
  calls: number;
};

export type AiEmbedResult = {
  vectors: number[][];
  provider: string;
  model: string;
  calls: number;
};

export interface AiAdapter {
  complete(args: {
    system: string;
    user: string;
    schema: z.ZodType;
    timeoutMs: number;
  }): Promise<AiCompleteResult>;
  embed(texts: string[]): Promise<AiEmbedResult>;
}

export function aiConfigured() {
  return Boolean(
    process.env.AI_ENABLED !== "false" &&
      process.env.AI_BASE_URL &&
      process.env.AI_API_KEY &&
      process.env.AI_MODEL,
  );
}

export function embeddingsConfigured() {
  return Boolean(
    process.env.AI_ENABLED !== "false" &&
      process.env.AI_BASE_URL &&
      process.env.AI_API_KEY &&
      process.env.EMBEDDING_MODEL,
  );
}
