import type { Disclosure } from "@/server/review/types";

export function ReviewLog({
  disclosure,
  log,
}: {
  disclosure: Disclosure | null;
  log: string[];
}) {
  const lines = [...(disclosure?.log ?? []), ...log.filter((l) => !(disclosure?.log ?? []).includes(l))];
  return (
    <section className="mt-6 rounded-xl border border-line bg-panel p-4">
      <h2 className="text-sm font-medium">Review log and AI disclosure</h2>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No review has been run yet.</p>
      ) : (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
