"use client";

import type { Role } from "@/server/db/schema";

export function ActionBar({
  status,
  role,
  canSubmit,
  reviewerName,
  onSubmit,
  onApprove,
  onRequestChanges,
}: {
  status: string;
  role: Role;
  canSubmit: boolean;
  reviewerName?: string;
  onSubmit: () => Promise<void>;
  onApprove: () => Promise<void>;
  onRequestChanges: () => Promise<void>;
}) {
  if (status === "approved") {
    return (
      <p className="rounded-md border border-ok px-3 py-2 text-sm text-ok">
        Approved{reviewerName ? ` by ${reviewerName}` : ""}.
      </p>
    );
  }
  if ((role === "creator" || role === "admin") && (status === "draft" || status === "changes_requested")) {
    return (
      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => void onSubmit()}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Submit for review
      </button>
    );
  }
  if ((role === "reviewer" || role === "admin") && status === "in_review") {
    return (
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void onApprove()}
          className="rounded-md bg-ok px-4 py-2 text-sm font-medium text-white"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => void onRequestChanges()}
          className="rounded-md border border-line px-4 py-2 text-sm"
        >
          Request changes
        </button>
      </div>
    );
  }
  return (
    <p className="text-sm text-muted">
      Waiting on the other role. Nothing is auto-approved or auto-rejected.
    </p>
  );
}
