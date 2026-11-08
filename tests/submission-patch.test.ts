import { describe, expect, it } from "vitest";
import { transition } from "@/server/workflow/transitions";
import { can } from "@/server/auth/permissions";

describe("submission edit invalidates approval", () => {
  it("transitions approved submission to draft on edit_content by creator", () => {
    const result = transition("approved", "edit_content", "creator");
    expect(result).toEqual({ ok: true, status: "draft" });
  });

  it("transitions approved submission to draft on edit_content by admin", () => {
    const result = transition("approved", "edit_content", "admin");
    expect(result).toEqual({ ok: true, status: "draft" });
  });

  it("forbids reviewers from editing submissions", () => {
    const permResult = can({
      role: "reviewer",
      permission: "submissions.edit",
      userId: "user-1",
      ownerId: "user-1",
    });
    expect(permResult).toBe(false);

    const transResult = transition("approved", "edit_content", "reviewer");
    expect(transResult.ok).toBe(false);
  });

  it("transitions in_review content edit appropriately", () => {
    const result = transition("in_review", "edit_content", "creator");
    expect(result.ok).toBe(true);
  });
});
