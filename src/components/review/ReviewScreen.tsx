"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/server/db/schema";
import type { NormalizedDocument } from "@/server/ingest/types";
import type { Disclosure, Finding } from "@/server/review/types";
import { ActionBar } from "./ActionBar";
import { DocumentView } from "./DocumentView";
import { FindingsPanel } from "./FindingsPanel";
import { ReviewLog } from "./ReviewLog";
import { StatusFlow } from "./StatusFlow";

type Payload = {
  submission: {
    id: string;
    title: string;
    status: string;
    sourceKind: string;
    creatorId: string;
    normalized: NormalizedDocument;
  };
  creatorName: string;
  approvedBy: string | null;
  activity: {
    id: string;
    action: string;
    detail: string;
    createdAt: string | Date;
    actorName: string | null;
  }[];
  latestReview: {
    id: string;
    deepStatus: string;
    score: number | null;
    discarded: number;
    verified: string[];
    disclosure: Disclosure;
  } | null;
  findings: Finding[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!json.ok) throw new Error(json.error?.message ?? "Request failed");
  return json.data as T;
}

export function ReviewScreen({
  initial,
  role,
  userId,
}: {
  initial: Payload;
  role: Role;
  userId: string;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(
    initial.submission.normalized.blocks.map((b) => b.text).join("\n\n"),
  );
  const [error, setError] = useState<string | null>(null);
  const deepPending = ["pending", "running"].includes(data.latestReview?.deepStatus ?? "");
  const canAct = role === "admin" || (role === "creator" && userId === data.submission.creatorId);

  useEffect(() => {
    const reviewId = data.latestReview?.id;
    if (!reviewId || !deepPending) return;
    const t = setInterval(() => {
      void api<Payload["latestReview"] & { findings: Finding[]; log: string[] }>(
        `/api/reviews/${reviewId}`,
      ).then((review) => {
        if (!review) return;
        setData((prev) => ({
          ...prev,
          latestReview: {
            id: reviewId,
            deepStatus: review.deepStatus,
            score: review.score,
            discarded: review.discarded,
            verified: review.verified,
            disclosure: review.disclosure,
          },
          findings: review.findings,
        }));
      });
    }, 1000);
    return () => clearInterval(t);
  }, [data.latestReview?.id, deepPending]);

  const canSubmit = useMemo(() => {
    const status = data.latestReview?.deepStatus;
    return Boolean(status && ["done", "skipped", "failed"].includes(status));
  }, [data.latestReview]);

  async function runReview() {
    setError(null);
    if (editing) {
      await api(`/api/submissions/${data.submission.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: draft }),
      });
      setEditing(false);
    }
    const result = await api<{ reviewId: string; fast: Finding[]; deepStatus: string }>(
      `/api/submissions/${data.submission.id}/review`,
      { method: "POST" },
    );
    setData((prev) => ({
      ...prev,
      findings: result.fast,
      latestReview: {
        id: result.reviewId,
        deepStatus: result.deepStatus,
        score: null,
        discarded: 0,
        verified: [],
        disclosure: prev.latestReview?.disclosure ?? {
          promptVersion: "",
          fast: { ran: true, externalCalls: 0 },
          deep: {
            status: result.deepStatus as Disclosure["deep"]["status"],
            provider: null,
            chatModel: null,
            embeddingModel: null,
            externalCalls: 0,
            sentToExternal: "sentence-level excerpts only",
            retrieval: "none",
          },
          dropped: 0,
          verifiedClaims: [],
        },
      },
    }));
    router.refresh();
  }

  async function reload() {
    const next = await api<Payload>(`/api/submissions/${data.submission.id}`);
    setData(next);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{data.submission.title}</h1>
          <p className="text-sm text-muted">Creator: {data.creatorName}</p>
        </div>
        <ActionBar
          status={data.submission.status}
          role={role}
          canSubmit={canSubmit}
          reviewerName={data.approvedBy ?? undefined}
          onSubmit={async () => {
            await api(`/api/submissions/${data.submission.id}/transition`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "submit" }),
            });
            await reload();
          }}
          onApprove={async () => {
            await api(`/api/submissions/${data.submission.id}/transition`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "approve" }),
            });
            await reload();
          }}
          onRequestChanges={async () => {
            await api(`/api/submissions/${data.submission.id}/transition`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "request_changes" }),
            });
            await reload();
          }}
        />
      </div>
      <StatusFlow status={data.submission.status} />
      {data.latestReview?.deepStatus === "skipped" ? (
        <p className="mb-4 rounded-md border border-line bg-panel px-3 py-2 text-sm">
          Deep checks off: external AI disabled
        </p>
      ) : null}
      {data.latestReview?.deepStatus === "failed" ? (
        <p className="mb-4 rounded-md border border-error bg-panel px-3 py-2 text-sm text-error">
          Deep checks failed. Fast results are still shown and the score is
          partial.
        </p>
      ) : null}
      {error ? <p className="mb-3 text-sm text-error">{error}</p> : null}
      <div className="mb-3 flex gap-2">
        {data.submission.sourceKind === "text" && canAct ? (
          <button
            type="button"
            className="rounded-md border border-line px-3 py-1.5 text-sm"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Close editor" : "Edit text"}
          </button>
        ) : null}
        {canAct ? (
          <button
            type="button"
            className="rounded-md bg-brand px-3 py-1.5 text-sm text-white"
            onClick={() => void runReview().catch((e) => setError(String(e.message ?? e)))}
          >
            Run review
          </button>
        ) : null}
      </div>
      <div className="grid gap-6 min-[860px]:grid-cols-[55%_1fr]">
        <section className="rounded-xl border border-line bg-panel p-5">
          {editing ? (
            <textarea
              className="min-h-[320px] w-full rounded-md border border-line bg-background p-3 font-serif"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            <DocumentView
              doc={data.submission.normalized}
              findings={data.findings}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </section>
        <FindingsPanel
          findings={data.findings}
          score={data.latestReview?.score ?? null}
          deepPending={deepPending}
          selectedId={selectedId}
          onSelect={setSelectedId}
          verified={data.latestReview?.verified ?? []}
          canAct={canAct}
          onApply={async (id) => {
            try {
              await api(`/api/findings/${id}/apply`, { method: "POST" });
              await reload();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Apply failed");
            }
          }}
          onDismiss={async (id, reason) => {
            await api(`/api/findings/${id}/dismiss`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ reason }),
            });
            await reload();
          }}
          onRestore={async (id) => {
            await api(`/api/findings/${id}/restore`, { method: "POST" });
            await reload();
          }}
        />
      </div>
      <ReviewLog
        disclosure={data.latestReview?.disclosure ?? null}
        log={data.latestReview?.disclosure.log ?? []}
        activity={data.activity}
      />
    </div>
  );
}
