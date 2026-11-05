export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { auth } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-8 shadow-sm">
        <p className="text-sm font-medium text-brand">Verity</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted">
          Brand governance for Kettle & Co. Use a seeded account.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
