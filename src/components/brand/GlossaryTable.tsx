"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

  async function create() {
    await fetch("/api/brand/glossary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    router.refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/brand/glossary/${id}`, { method: "DELETE" });
    router.refresh();
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
          <button type="submit" className="rounded-md bg-brand px-3 py-1.5 text-white">
            Add term
          </button>
        </form>
      ) : null}
    </section>
  );
}
