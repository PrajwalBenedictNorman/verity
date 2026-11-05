"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("creator@kettle.test");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/",
    });
    setPending(false);
    if (!result || result.error) {
      setError("Sign in failed. Check email and password.");
      return;
    }
    window.location.assign(result.url ?? "/");
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block text-sm">
        Email
        <input
          className="mt-1 w-full rounded-md border border-line bg-background px-3 py-2"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        Password
        <input
          className="mt-1 w-full rounded-md border border-line bg-background px-3 py-2"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error ? <p className="text-sm text-error">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
