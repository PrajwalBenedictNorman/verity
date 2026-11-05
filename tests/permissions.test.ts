import { describe, expect, it } from "vitest";
import { can, type Permission } from "@/server/auth/permissions";
import type { Role } from "@/server/db/schema";

const creator = "creator-id";
const other = "other-id";

const allPermissions: Permission[] = [
  "brand.read",
  "brand.edit",
  "submissions.create",
  "submissions.read",
  "submissions.edit",
  "submissions.review",
  "submissions.submit",
  "submissions.approve",
  "submissions.request_changes",
  "findings.apply",
  "findings.dismiss",
];

function allowed(role: Role, permission: Permission, ownerId?: string) {
  return can({ role, permission, userId: creator, ownerId });
}

describe("permissions", () => {
  it("admin can do everything", () => {
    for (const permission of allPermissions) {
      expect(allowed("admin", permission, other)).toBe(true);
    }
  });

  it("creator can work on own submissions only", () => {
    expect(allowed("creator", "submissions.create")).toBe(true);
    expect(allowed("creator", "submissions.read", creator)).toBe(true);
    expect(allowed("creator", "submissions.edit", creator)).toBe(true);
    expect(allowed("creator", "submissions.review", creator)).toBe(true);
    expect(allowed("creator", "submissions.submit", creator)).toBe(true);
    expect(allowed("creator", "findings.apply", creator)).toBe(true);
    expect(allowed("creator", "findings.dismiss", creator)).toBe(true);
    expect(allowed("creator", "brand.read")).toBe(true);

    expect(allowed("creator", "submissions.read", other)).toBe(false);
    expect(allowed("creator", "submissions.edit", other)).toBe(false);
    expect(allowed("creator", "submissions.approve", creator)).toBe(false);
    expect(allowed("creator", "submissions.request_changes", creator)).toBe(false);
    expect(allowed("creator", "brand.edit")).toBe(false);
  });

  it("reviewer can read all and decide, but cannot edit brand or own the creator path", () => {
    expect(allowed("reviewer", "submissions.read", other)).toBe(true);
    expect(allowed("reviewer", "submissions.approve", other)).toBe(true);
    expect(allowed("reviewer", "submissions.request_changes", other)).toBe(true);
    expect(allowed("reviewer", "brand.read")).toBe(true);

    expect(allowed("reviewer", "submissions.create")).toBe(false);
    expect(allowed("reviewer", "submissions.edit", other)).toBe(false);
    expect(allowed("reviewer", "submissions.submit", other)).toBe(false);
    expect(allowed("reviewer", "findings.apply", other)).toBe(false);
    expect(allowed("reviewer", "brand.edit")).toBe(false);
  });
});
