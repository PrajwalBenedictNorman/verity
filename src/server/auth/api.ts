import { auth } from "./session";
import { jsonError } from "@/lib/errors";
import { can, type Permission } from "./permissions";
import type { Role } from "@/server/db/schema";

export type ApiUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export async function requireApiUser() {
  const session = await auth();
  if (!session?.user) {
    return { user: null as ApiUser | null, error: jsonError("unauthenticated", "Sign in required", 401) };
  }
  return { user: session.user, error: null };
}

export function forbidUnless(
  user: ApiUser,
  permission: Permission,
  ownerId?: string,
) {
  if (!can({ role: user.role, permission, userId: user.id, ownerId })) {
    return jsonError("forbidden", "Not allowed", 403);
  }
  return null;
}
