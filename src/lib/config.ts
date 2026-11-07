export const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM ?? 1536);

export const READY_THRESHOLD = 80;
export const SCORE_ERROR_COST = 15;
export const SCORE_WARN_COST = 6;
export const CONFIDENCE_QUESTION_THRESHOLD = 0.6;
export const RETRIEVAL_MIN_SIM = Number(process.env.RETRIEVAL_MIN_SIM ?? 0.3);
export const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 30_000);
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_INPUT_CHARS = 100_000;
