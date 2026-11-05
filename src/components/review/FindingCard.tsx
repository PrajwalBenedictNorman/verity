"use client";

import { useState } from "react";
import type { Finding } from "@/server/review/types";

function labelFor(finding: Finding) {
  if (finding.severity === "error") return "Must fix";
  if (finding.severity === "warn") return "Style";
  return "Check this";
}

export function FindingCard({
  finding,
  selected,
  onSelect,
  onApply,
  onDismiss,
  canAct,
}: {
  finding: Finding;
  selected: boolean;
  onSelect: () => void;
  onApply: () => Promise<void>;
  onDismiss: (reason: string) => Promise<void>;
  canAct: boolean;
}) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <article
      id={`finding-${finding.id}`}
      className={`rounded-xl border p-4 ${selected ? "border-brand" : "border-line"} bg-panel`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <p className="font-medium">
          {finding.kind} · {labelFor(finding)}
        </p>
        <p className="text-muted">
          {finding.tier} · {Math.round(finding.confidence * 100)}%
        </p>
      </div>
      <p className="mt-2 text-sm">{finding.message}</p>
      <blockquote className="mt-3 rounded-md border border-line bg-background p-2 text-sm">
        <p className="font-medium">
          {finding.source.code} {finding.source.type}
        </p>
        <p className="mt-1 text-muted">{finding.source.snapshot}</p>
      </blockquote>
      {finding.suggestion ? (
        <p className="mt-2 text-sm">
          Suggestion: <span className="font-medium">{finding.suggestion}</span>
        </p>
      ) : null}
      {canAct ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {finding.suggestion ? (
            <button
              type="button"
              className="rounded-md bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                setBusy(true);
                void onApply().finally(() => setBusy(false));
              }}
            >
              Apply fix
            </button>
          ) : null}
          {!open ? (
            <button
              type="button"
              className="rounded-md border border-line px-3 py-1.5 text-sm"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(true);
              }}
            >
              Dismiss
            </button>
          ) : (
            <div className="flex w-full flex-col gap-2" onClick={(e) => e.stopPropagation()}>
              <input
                className="rounded-md border border-line bg-background px-2 py-1 text-sm"
                placeholder="Reason (at least 3 characters)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                type="button"
                className="self-start rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={reason.trim().length < 3 || busy}
                onClick={() => {
                  setBusy(true);
                  void onDismiss(reason.trim()).finally(() => setBusy(false));
                }}
              >
                Confirm dismiss
              </button>
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}
