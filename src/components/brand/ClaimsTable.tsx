"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Claim = { id: string; code: string; text: string };

export function ClaimsTable({
  rows,
  canEdit,
}: {
  rows: Claim[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ code: "", text: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/brand/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ code: "", text: "" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add claim");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiRequest(`/api/brand/claims/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete claim");
    }
  }

  return (
    <section>
      <h2 className="mb-2 font-medium">Approved claims</h2>
      <ul className="space-y-2 text-sm">
        {rows.map((c) => (
          <li key={c.id} className="rounded-lg border border-line bg-panel p-3">
            <span className="font-medium">{c.code}</span> {c.text}
            {canEdit ? (
              <button type="button" className="ml-3 text-error" onClick={() => void remove(c.id)}>
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form
          className="mt-3 grid gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            className="rounded-md border border-line px-2 py-1"
            placeholder="Code (AC-x)"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
          <textarea
            className="rounded-md border border-line px-2 py-1"
            placeholder="Approved claim text"
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="w-fit rounded-md bg-brand px-3 py-1.5 text-white disabled:opacity-50"
          >
            Add claim
          </button>
        </form>
      ) : null}
      {error ? <p className="mt-2 text-sm text-error">{error}</p> : null}
    </section>
  );
}
