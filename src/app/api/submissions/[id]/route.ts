import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { activityLog, findings, submissions, users } from "@/server/db/schema";
import { normalize } from "@/server/ingest/normalize";
import { latestReview } from "@/server/review/orchestrator";
import { rowToFinding } from "@/server/review/map";
import { transition } from "@/server/workflow/transitions";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ text: z.string().min(1) });

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/submissions/[id]">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const { id } = await ctx.params;
  const db = getDb();
  const [row] = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
  if (!row) return jsonError("not_found", "Submission not found", 404);
  const denied = forbidUnless(user, "submissions.read", row.creatorId);
  if (denied) return denied;
  const [creator] = await db.select().from(users).where(eq(users.id, row.creatorId)).limit(1);
  const review = await latestReview(row.id);
  const reviewFindings = review
    ? (await db.select().from(findings).where(eq(findings.reviewId, review.id))).map(rowToFinding)
    : [];
  const log = await db
    .select({
      id: activityLog.id,
      action: activityLog.action,
      detail: activityLog.detail,
      createdAt: activityLog.createdAt,
      actorName: users.name,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.actorId))
    .where(eq(activityLog.submissionId, row.id))
    .orderBy(asc(activityLog.createdAt));
  const approvedBy = [...log]
    .reverse()
    .find((entry) => entry.action === "approve")?.actorName;
  return jsonOk({
    submission: row,
    creatorName: creator?.name ?? "Unknown",
    approvedBy: approvedBy ?? null,
    activity: log,
    latestReview: review
      ? {
          id: review.id,
          deepStatus: review.deepStatus,
          score: review.score,
          discarded: review.discardedCount,
          verified: review.verifiedClaimCodes,
          disclosure: review.disclosure,
          fastMs: review.fastMs,
          deepMs: review.deepMs,
        }
      : null,
    findings: reviewFindings,
  });
}

export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/submissions/[id]">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const { id } = await ctx.params;
  try {
    const body = patchSchema.parse(await req.json());
    const db = getDb();

    type TxResult =
      | { ok: true; status: string }
      | { ok: false; status: number; code: string; message: string; response?: Response };

    const result = await db.transaction<TxResult>(async (tx) => {
      const [row] = await tx
        .select()
        .from(submissions)
        .where(eq(submissions.id, id))
        .for("update")
        .limit(1);

      if (!row) {
        return { ok: false, status: 404, code: "not_found", message: "Submission not found" };
      }

      const denied = forbidUnless(user, "submissions.edit", row.creatorId);
      if (denied) {
        return { ok: false, status: 403, code: "forbidden", message: "Forbidden", response: denied };
      }

      if (row.sourceKind !== "text") {
        return {
          ok: false,
          status: 409,
          code: "unsupported",
          message: "Edit text works on pasted text. Copy suggestions for files.",
        };
      }

      const nextStatus = transition(row.status, "edit_content", user.role);
      if (!nextStatus.ok) {
        return { ok: false, status: 403, code: "forbidden", message: nextStatus.error };
      }

      const normalized = await normalize({ kind: "text", text: body.text, filename: row.title });

      await tx
        .update(submissions)
        .set({
          normalized,
          status: nextStatus.status,
          updatedAt: new Date(),
        })
        .where(eq(submissions.id, id));

      if (row.status === "approved" && nextStatus.status === "draft") {
        await tx.insert(activityLog).values({
          submissionId: id,
          actorId: user.id,
          action: "edit_after_approval",
          detail: "Editing returned this to draft.",
        });
      }

      return { ok: true, status: nextStatus.status };
    });

    if (!result.ok) {
      if (result.response) return result.response;
      return jsonError(result.code, result.message, result.status);
    }

    return jsonOk({ id, status: result.status });
  } catch (err) {
    return toErrorResponse(err);
  }
}
