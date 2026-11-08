export type DeepStats = {
  calls: number;
  retries: number;
  cacheHits: number;
};

export function createDeepStats(): DeepStats {
  return {
    calls: 0,
    retries: 0,
    cacheHits: 0,
  };
}
