import type { Role } from "@/server/db/schema";

export type Permission =
  | "brand.read"
  | "brand.edit"
  | "submissions.create"
  | "submissions.read"
  | "submissions.edit"
  | "submissions.review"
  | "submissions.submit"
  | "submissions.approve"
  | "submissions.request_changes"
  | "findings.apply"
  | "findings.dismiss";

export function can(args: {
  role: Role;
  permission: Permission;
  userId: string;
  ownerId?: string;
}): boolean {
  const { role, permission, userId, ownerId } = args;
  if (role === "admin") return true;

  const own = ownerId !== undefined && ownerId === userId;

  switch (permission) {
    case "brand.read":
      return true;
    case "brand.edit":
      return false;
    case "submissions.create":
      return role === "creator";
    case "submissions.read":
      return role === "reviewer" || own;
    case "submissions.edit":
      return role === "creator" && own;
    case "submissions.review":
      return role === "creator" && own;
    case "submissions.submit":
      return role === "creator" && own;
    case "submissions.approve":
    case "submissions.request_changes":
      return role === "reviewer";
    case "findings.apply":
    case "findings.dismiss":
      return role === "creator" && own;
    default: {
      const _exhaustive: never = permission;
      return _exhaustive;
    }
  }
}

export function requirePermission(args: Parameters<typeof can>[0]) {
  if (!can(args)) {
    throw new Error(`Not allowed: ${args.permission}`);
  }
}
