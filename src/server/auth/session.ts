import { getServerSession } from "next-auth";
import { authOptions } from "./options";

export function auth() {
  return getServerSession(authOptions);
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthenticated");
  }
  return session.user;
}
