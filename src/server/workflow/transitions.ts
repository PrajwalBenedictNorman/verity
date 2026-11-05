import type { Role } from "@/server/db/schema";

export type SubmissionStatus =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved";

export type WorkflowAction =
  | "submit"
  | "approve"
  | "request_changes"
  | "edit_content";

export type TransitionResult =
  | { ok: true; status: SubmissionStatus }
  | { ok: false; error: string };

const allowed: Record<
  SubmissionStatus,
  Partial<Record<WorkflowAction, SubmissionStatus>>
> = {
  draft: { submit: "in_review", edit_content: "draft" },
  changes_requested: { submit: "in_review", edit_content: "changes_requested" },
  in_review: {
    approve: "approved",
    request_changes: "changes_requested",
    edit_content: "in_review",
  },
  approved: { edit_content: "draft" },
};

function roleAllows(role: Role, action: WorkflowAction) {
  if (role === "admin") return true;
  if (action === "submit" || action === "edit_content") return role === "creator";
  if (action === "approve" || action === "request_changes") return role === "reviewer";
  return false;
}

export function transition(
  status: SubmissionStatus,
  action: WorkflowAction,
  role: Role,
): TransitionResult {
  if (!roleAllows(role, action)) {
    return { ok: false, error: `${role} cannot ${action}` };
  }
  const next = allowed[status][action];
  if (!next) {
    return { ok: false, error: `Cannot ${action} from ${status}` };
  }
  return { ok: true, status: next };
}
