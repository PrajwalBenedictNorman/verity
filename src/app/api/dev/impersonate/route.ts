import { encode } from "next-auth/jwt";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

const ALLOWED = [
  "creator@kettle.test",
  "reviewer@kettle.test",
  "admin@kettle.test",
];

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Not found" } },
      { status: 404 },
    );
  }
  const body = (await req.json()) as { email?: string };
  const email = body.email?.toLowerCase();
  if (!email || !ALLOWED.includes(email)) {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Unknown seed user" } },
      { status: 400 },
    );
  }
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "User not seeded" } },
      { status: 404 },
    );
  }
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: { code: "config", message: "NEXTAUTH_SECRET is not set" } },
      { status: 500 },
    );
  }
  const token = await encode({
    token: {
      id: user.id,
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    secret,
  });
  const res = NextResponse.json({ ok: true, data: { email: user.email } });
  res.cookies.set("next-auth.session-token", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
