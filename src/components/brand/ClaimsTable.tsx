"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

  async function create() {
    await fetch("/api/brand/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    router.refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/brand/claims/${id}`, { method: "DELETE" });
    router.refresh();
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
          <button type="submit" className="w-fit rounded-md bg-brand px-3 py-1.5 text-white">
            Add claim
          </button>
        </form>
      ) : null}
    </section>
  );
}
