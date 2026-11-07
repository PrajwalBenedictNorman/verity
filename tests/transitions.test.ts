import { describe, expect, it } from "vitest";
import { transition } from "@/server/workflow/transitions";

describe("workflow transitions", () => {
  it("lets creators submit drafts and creators edit their own content", () => {
    expect(transition("draft", "submit", "creator")).toEqual({
      ok: true,
      status: "in_review",
    });
    expect(transition("approved", "edit_content", "creator")).toEqual({
      ok: true,
      status: "draft",
    });
    expect(transition("in_review", "edit_content", "creator")).toEqual({
      ok: true,
      status: "in_review",
    });
  });

  it("lets reviewers approve or request changes only while in review", () => {
    expect(transition("in_review", "approve", "reviewer")).toEqual({
      ok: true,
      status: "approved",
    });
    expect(transition("in_review", "request_changes", "reviewer")).toEqual({
      ok: true,
      status: "changes_requested",
    });
    expect(transition("draft", "approve", "reviewer").ok).toBe(false);
  });

  it("does not let creators approve or reviewers submit", () => {
    expect(transition("in_review", "approve", "creator").ok).toBe(false);
    expect(transition("draft", "submit", "reviewer").ok).toBe(false);
  });

  it("lets admins perform any valid transition but not invalid ones", () => {
    expect(transition("in_review", "approve", "admin")).toEqual({
      ok: true,
      status: "approved",
    });
    expect(transition("approved", "approve", "admin").ok).toBe(false);
  });
});
