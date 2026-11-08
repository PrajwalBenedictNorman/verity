"use client";

import type { Finding } from "@/server/review/types";
import { FindingCard } from "./FindingCard";
import { ScoreBar } from "./ScoreBar";

export function FindingsPanel({
  findings,
  score,
  deepPending,
  selectedId,
  onSelect,
  onApply,
  onDismiss,
  onRestore,
  verified,
  canAct,
  busy = false,
}: {
  findings: Finding[];
  score: number | null;
  deepPending: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onApply: (id: string) => Promise<void>;
  onDismiss: (id: string, reason: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  verified: string[];
  canAct: boolean;
  busy?: boolean;
}) {
  const open = findings.filter((f) => f.state === "open");
  const dismissed = findings.filter((f) => f.state === "dismissed");
  return (
    <aside className="space-y-4">
      <ScoreBar score={score} deepPending={deepPending} />
      {verified.length > 0 ? (
        <p className="text-sm">
          Verified against approved claims: {verified.join(", ")}
        </p>
      ) : null}
      <div className="space-y-3">
        {open.length === 0 ? (
          <p className="text-sm text-muted">
            {findings.length === 0 ? "Fast tier clean so far." : "No open findings."}
          </p>
        ) : (
          open.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              selected={selectedId === finding.id}
              onSelect={() => onSelect(finding.id)}
              onApply={() => onApply(finding.id)}
              onDismiss={(reason) => onDismiss(finding.id, reason)}
              canAct={canAct}
              busy={busy}
            />
          ))
        )}
      </div>
      {dismissed.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-medium">Dismissed</h3>
          <ul className="space-y-2 text-sm">
            {dismissed.map((f) => (
              <li key={f.id} className="rounded-md border border-line p-2">
                <p>
                  {f.kind}: {f.message}
                </p>
                <p className="text-muted">Reason: {f.dismissReason}</p>
                {canAct ? (
                  <button
                    type="button"
                    className="mt-1 text-brand"
                    onClick={() => void onRestore(f.id)}
                  >
                    Restore
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
