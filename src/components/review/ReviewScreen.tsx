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

export const blocksToText = (d: NormalizedDocument) =>
  d.blocks.map((b) => b.text).join("\n\n");

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let json: { ok: boolean; data?: T; error?: { message: string } };
  try {
    json = await res.json();
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }
  if (!json.ok) throw new Error(json.error?.message ?? `Request failed (${res.status})`);
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
  const [applying, setApplying] = useState(false);
  const [draft, setDraft] = useState(
    initial.submission.normalized.blocks.map((b) => b.text).join("\n\n"),
  );
  const [error, setError] = useState<string | null>(null);
  const deepPending = ["pending", "running"].includes(data.latestReview?.deepStatus ?? "");
  const canAct = role === "admin" || (role === "creator" && userId === data.submission.creatorId);

  useEffect(() => {
    const reviewId = data.latestReview?.id;
    if (!reviewId || !deepPending) return;

    let inFlight = false;
    let failCount = 0;
    const startTime = Date.now();
    const MAX_POLL_MS = 180_000;

    const t = setInterval(() => {
      if (inFlight) return;
      if (Date.now() - startTime > MAX_POLL_MS) {
        clearInterval(t);
        setError("Deep checks are taking longer than expected. Reload to check again.");
        return;
      }

      inFlight = true;
      api<Payload["latestReview"] & { findings: Finding[]; log: string[] }>(
        `/api/reviews/${reviewId}`,
      )
        .then((review) => {
          failCount = 0;
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

          if (["done", "failed", "skipped"].includes(review.deepStatus)) {
            clearInterval(t);
            void reload();
          }
        })
        .catch(() => {
          failCount += 1;
          if (failCount >= 5) {
            clearInterval(t);
            setError("Lost connection. Reload to check again.");
          }
        })
        .finally(() => {
          inFlight = false;
        });
    }, 1000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.latestReview?.id, deepPending]);

  const canSubmit = useMemo(() => {
    const status = data.latestReview?.deepStatus;
    return Boolean(status && ["done", "skipped", "failed"].includes(status));
  }, [data.latestReview]);

  const retryableCodes = useMemo(
    () =>
      new Set([
        "rate_limited",
        "provider_unavailable",
        "timeout",
        "quota_exceeded",
        "interrupted",
      ]),
    [],
  );
  const errorCode = data.latestReview?.disclosure?.deep?.errorCode;
  const retryableError = errorCode ? retryableCodes.has(errorCode) : true;

  async function retryDeepChecks() {
    setError(null);
    try {
      const res = await api<{ reviewId: string; deepStatus: string }>(
        `/api/submissions/${data.submission.id}/review/deep`,
        { method: "POST" },
      );
      setData((prev) => ({
        ...prev,
        latestReview: prev.latestReview
          ? {
              ...prev.latestReview,
              id: res.reviewId,
              deepStatus: "running",
              disclosure: {
                ...prev.latestReview.disclosure,
                deep: {
                  ...prev.latestReview.disclosure?.deep,
                  status: "running",
                  errorCode: undefined,
                  errorMessage: undefined,
                },
              },
            }
          : null,
      }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to retry deep checks",
      );
    }
  }

  async function reload() {
    const next = await api<Payload>(`/api/submissions/${data.submission.id}`);
    setData(next);
    setDraft(blocksToText(next.submission.normalized));
    setError(null);
    router.refresh();
  }

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
    const freshDisclosure: Disclosure = {
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
      log: [],
    };
    setData((prev) => ({
      ...prev,
      findings: result.fast,
      latestReview: {
        id: result.reviewId,
        deepStatus: result.deepStatus,
        score: null,
        discarded: 0,
        verified: [],
        disclosure: freshDisclosure,
      },
    }));
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
          {data.latestReview.disclosure?.deep?.skipReason === "not_rerun_after_edit"
            ? "Deep checks were not re-run after this edit. Click Run review to re-check."
            : "Deep checks off: external AI disabled"}
        </p>
      ) : null}
      {data.latestReview?.deepStatus === "failed" ? (
        <div role="alert" className="mb-4 rounded-md border border-error/40 bg-error/10 p-3 text-sm text-error">
          <p className="font-semibold">Deep checks failed. Fast results are shown below.</p>
          {data.latestReview.disclosure?.deep?.errorMessage ? (
            <p className="mt-1 text-sm opacity-90">
              {data.latestReview.disclosure.deep.errorMessage}
            </p>
          ) : null}
          {retryableError && canAct ? (
            <button
              type="button"
              onClick={retryDeepChecks}
              className="mt-2 inline-flex items-center rounded bg-error px-2.5 py-1 text-xs font-medium text-white hover:bg-error/90 cursor-pointer"
            >
              Retry deep checks
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="mb-3 text-sm text-error">{error}</p> : null}
      <div className="mb-3 flex gap-2">
        {data.submission.sourceKind === "text" && canAct ? (
          <button
            type="button"
            className="rounded-md border border-line px-3 py-1.5 text-sm"
            onClick={() => {
              if (!editing) setDraft(blocksToText(data.submission.normalized));
              setEditing((v) => !v);
            }}
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
      <div className="grid grid-cols-1 gap-6 min-[861px]:grid-cols-[55%_1fr]">
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
          busy={applying || editing}
          onApply={async (id) => {
            if (applying) return;
            setApplying(true);
            try {
              await api(`/api/findings/${id}/apply`, { method: "POST" });
              await reload();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Apply failed");
              await reload();
            } finally {
              setApplying(false);
            }
          }}
          onDismiss={async (id, reason) => {
            try {
              await api(`/api/findings/${id}/dismiss`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ reason }),
              });
              await reload();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Dismiss failed");
            }
          }}
          onRestore={async (id) => {
            try {
              await api(`/api/findings/${id}/restore`, { method: "POST" });
              await reload();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Restore failed");
            }
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
