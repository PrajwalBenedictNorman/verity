"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewSubmissionPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("title", title);
    if (file) form.set("file", file);
    if (text.trim()) form.set("text", text);
    const res = await fetch("/api/submissions", { method: "POST", body: form });
    const json = (await res.json()) as {
      ok: boolean;
      data?: { id: string };
      error?: { message: string };
    };
    setPending(false);
    if (!json.ok || !json.data) {
      setError(json.error?.message ?? "Could not create submission");
      return;
    }
    router.push(`/submissions/${json.data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">New submission</h1>
      <label className="block text-sm">
        Title
        <input
          className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        Paste text
        <textarea
          className="mt-1 min-h-[220px] w-full rounded-md border border-line bg-panel px-3 py-2 font-serif"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        Or upload a file (text, PDF, DOCX, image)
        <input
          className="mt-1 block"
          type="file"
          accept=".txt,.pdf,.docx,image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {error ? <p className="text-sm text-error">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create submission"}
      </button>
    </form>
  );
}
