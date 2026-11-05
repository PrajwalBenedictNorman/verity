"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SEED_USERS = [
  { email: "creator@kettle.test", label: "Creator" },
  { email: "reviewer@kettle.test", label: "Reviewer" },
  { email: "admin@kettle.test", label: "Admin" },
];

export function RoleSwitcher({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  if (process.env.NODE_ENV === "production") return null;

  async function switchTo(email: string) {
    setError(null);
    const res = await fetch("/api/dev/impersonate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const json = (await res.json()) as { ok: boolean; error?: { message: string } };
    if (!json.ok) {
      setError(json.error?.message ?? "Switch failed");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {SEED_USERS.map((u) => (
        <button
          key={u.email}
          type="button"
          onClick={() => void switchTo(u.email)}
          disabled={u.email === currentEmail}
          className="rounded-md border border-line px-2 py-1 text-xs disabled:opacity-50"
        >
          {u.label}
        </button>
      ))}
      {error ? <span className="text-xs text-error">{error}</span> : null}
    </div>
  );
}
