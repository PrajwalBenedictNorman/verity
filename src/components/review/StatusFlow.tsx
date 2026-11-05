const STEPS = [
  { key: "draft", label: "Draft" },
  { key: "in_review", label: "In review" },
  { key: "changes_requested", label: "Changes requested" },
  { key: "approved", label: "Approved" },
] as const;

export function StatusFlow({ status }: { status: string }) {
  return (
    <ol className="mb-4 flex flex-wrap gap-2 text-sm">
      {STEPS.map((step, i) => {
        const active = step.key === status;
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={
                active
                  ? "rounded-full bg-brand px-3 py-1 font-medium text-white"
                  : "rounded-full border border-line px-3 py-1 text-muted"
              }
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 ? <span className="text-muted">→</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
