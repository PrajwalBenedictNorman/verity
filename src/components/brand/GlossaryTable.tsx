"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Term = {
  id: string;
  code: string;
  badTerm: string;
  preferredTerm: string;
  matchMode: string;
};

export function GlossaryTable({
  rows,
  canEdit,
}: {
  rows: Term[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    code: "GL-2.1",
    badTerm: "",
    preferredTerm: "",
    matchMode: "word",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/brand/glossary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ ...form, badTerm: "", preferredTerm: "" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add term");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiRequest(`/api/brand/glossary/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete term");
    }
  }

  return (
    <section>
      <h2 className="mb-2 font-medium">Glossary</h2>
      <table className="w-full text-left text-sm">
        <thead className="text-muted">
          <tr>
            <th className="py-1">Code</th>
            <th>Avoid</th>
            <th>Prefer</th>
            <th>Mode</th>
            {canEdit ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id} className="border-t border-line">
              <td className="py-2">{g.code}</td>
              <td>{g.badTerm}</td>
              <td>{g.preferredTerm}</td>
              <td>{g.matchMode}</td>
              {canEdit ? (
                <td>
                  <button type="button" className="text-error" onClick={() => void remove(g.id)}>
                    Delete
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit ? (
        <form
          className="mt-3 flex flex-wrap gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            className="rounded-md border border-line px-2 py-1"
            placeholder="Code"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
          <input
            className="rounded-md border border-line px-2 py-1"
            placeholder="Avoid"
            value={form.badTerm}
            onChange={(e) => setForm({ ...form, badTerm: e.target.value })}
            required
          />
          <input
            className="rounded-md border border-line px-2 py-1"
            placeholder="Prefer"
            value={form.preferredTerm}
            onChange={(e) => setForm({ ...form, preferredTerm: e.target.value })}
            required
          />
          <select
            className="rounded-md border border-line px-2 py-1"
            value={form.matchMode}
            onChange={(e) => setForm({ ...form, matchMode: e.target.value })}
          >
            <option value="word">word</option>
            <option value="phrase">phrase</option>
          </select>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-brand px-3 py-1.5 text-white disabled:opacity-50"
          >
            Add term
          </button>
        </form>
      ) : null}
      {error ? <p className="mt-2 text-sm text-error">{error}</p> : null}
    </section>
  );
}
