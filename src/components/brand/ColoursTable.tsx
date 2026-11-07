"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Colour = {
  id: string;
  name: string;
  hex: string;
  maxDeviation: number;
};

export function ColoursTable({
  rows,
  canEdit,
}: {
  rows: Colour[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    hex: "#1F3A5F",
    maxDeviation: 10,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/brand/colours", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm({ ...form, name: "" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add colour");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await apiRequest(`/api/brand/colours/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete colour");
    }
  }

  return (
    <section>
      <h2 className="mb-2 font-medium">Brand colours</h2>
      <ul className="space-y-2 text-sm">
        {rows.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-2 rounded-lg border border-line bg-panel p-3"
          >
            <span
              className="inline-block h-5 w-5 rounded border border-line"
              style={{ background: c.hex }}
            />
            <span>
              {c.name} {c.hex} · ±{c.maxDeviation}
            </span>
            {canEdit ? (
              <button type="button" className="ml-auto text-error" onClick={() => void remove(c.id)}>
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            className="rounded-md border border-line px-2 py-1"
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            className="rounded-md border border-line px-2 py-1"
            placeholder="#RRGGBB"
            value={form.hex}
            onChange={(e) => setForm({ ...form, hex: e.target.value })}
            required
          />
          <input
            type="number"
            className="w-24 rounded-md border border-line px-2 py-1"
            placeholder="Deviation"
            value={form.maxDeviation}
            onChange={(e) =>
              setForm({ ...form, maxDeviation: Number(e.target.value) })
            }
            required
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-brand px-3 py-1.5 text-white disabled:opacity-50"
          >
            Add colour
          </button>
        </form>
      ) : null}
      {error ? <p className="mt-2 text-sm text-error">{error}</p> : null}
    </section>
  );
}
