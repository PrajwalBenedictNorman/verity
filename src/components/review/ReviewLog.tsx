import type { Disclosure } from "@/server/review/types";

type ActivityEntry = {
  id: string;
  action: string;
  detail: string;
  createdAt: string | Date;
  actorName: string | null;
};

export function ReviewLog({
  disclosure,
  log,
  activity = [],
}: {
  disclosure: Disclosure | null;
  log: string[];
  activity?: ActivityEntry[];
}) {
  const structured: string[] = [];
  if (disclosure) {
    const deep = disclosure.deep;
    structured.push(
      `Fast tier: ${disclosure.fast.ran ? "ran" : "skipped"} with ${disclosure.fast.externalCalls} external calls.`,
    );
    structured.push(
      `Deep tier: ${deep.status}; provider ${deep.provider ?? "none"}; chat ${deep.chatModel ?? "none"}; embeddings ${deep.embeddingModel ?? "none"}.`,
    );
    structured.push(
      `Retrieval: ${deep.retrieval}; ${deep.externalCalls} external calls; sent to external: ${deep.sentToExternal}.`,
    );

    const extras: string[] = [];
    if (deep.retries && deep.retries > 0) {
      extras.push(`${deep.retries} retry attempt(s) were made.`);
    }
    if (deep.cacheHits && deep.cacheHits > 0) {
      extras.push(`${deep.cacheHits} response(s) were served from cache.`);
    }
    if (deep.partial) {
      extras.push("Partial results: claim checks completed before deep tier halted.");
    }
    if (deep.fallbackUsed) {
      extras.push("Fallback model was used for completion.");
    }
    if (extras.length > 0) {
      structured.push(extras.join(" "));
    }

    structured.push(
      `Source-or-silence dropped ${disclosure.dropped} finding(s).`,
    );
    structured.push(
      disclosure.verifiedClaims.length
        ? `Verified against approved claims: ${disclosure.verifiedClaims.join(", ")}.`
        : "No approved claims were verified.",
    );
  }
  const lines = [...structured, ...log];

  return (
    <section className="mt-6 rounded-xl border border-line bg-panel p-4">
      <h2 className="text-sm font-medium">Review log and AI disclosure</h2>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No review has been run yet.</p>
      ) : (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      )}
      {activity.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-medium">Activity</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {activity.map((entry) => (
              <li key={entry.id}>
                <span className="text-muted">
                  {new Date(entry.createdAt)
                    .toISOString()
                    .slice(0, 16)
                    .replace("T", " ")}{" "}
                  UTC ·{" "}
                </span>
                {entry.actorName ?? "System"} · {entry.action}: {entry.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
