import { SCORE_CONFIG, readinessLabel } from "@/server/review/scoring";

export function ScoreBar({
  score,
  deepPending,
}: {
  score: number | null;
  deepPending: boolean;
}) {
  const label = readinessLabel(score, deepPending);
  const value = deepPending || score === null ? null : score;
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="text-sm text-muted">Score</p>
      <p className="mt-1 text-4xl font-semibold tabular-nums">
        {value === null ? "…" : value}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
        <div
          className="h-full bg-brand"
          style={{ width: `${value ?? 0}%` }}
        />
      </div>
      {deepPending ? (
        <p className="mt-2 text-sm text-muted">Deep checks running</p>
      ) : (
        <p className="mt-2 text-sm">{label}</p>
      )}
      <p className="mt-1 text-xs text-muted">
        Ready at {SCORE_CONFIG.readyThreshold}. Questions do not change the score.
      </p>
    </div>
  );
}
