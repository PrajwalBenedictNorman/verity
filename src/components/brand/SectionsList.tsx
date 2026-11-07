"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Section = {
  id: string;
  code: string;
  category: string;
  title: string;
  body: string;
};

export function SectionsList({
  rows,
  canEdit,
}: {
  rows: Section[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    code: "",
    category: "Terminology",
    title: "",
    body: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/brand/sections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ ...form, code: "", title: "", body: "" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add section");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiRequest(`/api/brand/sections/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete section");
    }
  }

  return (
    <section>
      <h2 className="mb-2 font-medium">Guideline sections</h2>
      <ul className="space-y-2 text-sm">
        {rows.map((s) => (
          <li key={s.id} className="rounded-lg border border-line bg-panel p-3">
            <p className="font-medium">
              {s.code} · {s.category}: {s.title}
            </p>
            <p className="mt-1 text-muted">{s.body}</p>
            {canEdit ? (
              <button type="button" className="mt-2 text-error" onClick={() => void remove(s.id)}>
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
            placeholder="Code (GL-x.x)"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
          <input
            className="rounded-md border border-line px-2 py-1"
            placeholder="Category"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            required
          />
          <input
            className="rounded-md border border-line px-2 py-1"
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
          <textarea
            className="rounded-md border border-line px-2 py-1"
            placeholder="Body"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="w-fit rounded-md bg-brand px-3 py-1.5 text-white disabled:opacity-50"
          >
            Add section
          </button>
        </form>
      ) : null}
      {error ? <p className="mt-2 text-sm text-error">{error}</p> : null}
    </section>
  );
}
