"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      className="text-sm text-muted hover:text-ink"
      onClick={() => void signOut({ callbackUrl: "/login" })}
    >
      Sign out
    </button>
  );
}
