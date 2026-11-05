export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth/session";
import { RoleSwitcher } from "@/components/nav/RoleSwitcher";
import { SignOutButton } from "@/components/nav/SignOutButton";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { user } = session;

  return (
    <div className="min-h-full">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold">
              Verity
            </Link>
            <span className="text-sm text-muted">Kettle & Co.</span>
            <nav className="flex gap-3 text-sm">
              <Link href="/" className="hover:text-brand">
                Review
              </Link>
              <Link href="/brand" className="hover:text-brand">
                Brand rules
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">
              {user.name} · {user.role}
            </span>
            <RoleSwitcher currentEmail={user.email} />
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
    </div>
  );
}
