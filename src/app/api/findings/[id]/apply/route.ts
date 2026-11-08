import { desc, eq } from "drizzle-orm";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { activityLog, findings, reviews, submissions } from "@/server/db/schema";
import { applyFindingToDocument } from "@/server/review/apply";
import { startReview } from "@/server/review/orchestrator";
import { transition } from "@/server/workflow/transitions";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/findings/[id]/apply">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const { id } = await ctx.params;

  try {
    const db = getDb();

    type TxResult =
      | { ok: true; submissionId: string }
      | { ok: false; status: number; code: string; message: string; response?: Response };

    const result = await db.transaction<TxResult>(async (tx) => {
      // 1. Load the finding
      const [finding] = await tx
        .select()
        .from(findings)
        .where(eq(findings.id, id))
        .limit(1);

      if (!finding) {
        return { ok: false, status: 404, code: "not_found", message: "Finding not found" };
      }

      // Reject if already handled (double click protection)
      if (finding.state !== "open") {
        return {
          ok: false,
          status: 409,
          code: "already_handled",
          message: "This finding has already been handled.",
        };
      }

      // 2. Load the review
      const [review] = await tx
        .select()
        .from(reviews)
        .where(eq(reviews.id, finding.reviewId))
        .limit(1);

      if (!review) {
        return { ok: false, status: 404, code: "not_found", message: "Review not found" };
      }

      // 3. Load submission with lock
      const [submission] = await tx
        .select()
        .from(submissions)
        .where(eq(submissions.id, review.submissionId))
        .for("update")
        .limit(1);

      if (!submission) {
        return { ok: false, status: 404, code: "not_found", message: "Submission not found" };
      }

      const denied = forbidUnless(user, "findings.apply", submission.creatorId);
      if (denied) return { ok: false, status: 403, code: "forbidden", message: "Forbidden", response: denied };

      if (submission.sourceKind !== "text") {
        return {
          ok: false,
          status: 409,
          code: "unsupported",
          message: "Apply fix works on pasted text. Copy the suggestion for files.",
        };
      }

      // 4. Stale review check: check if finding's review is latest review of submission
      const [latestRev] = await tx
        .select({ id: reviews.id })
        .from(reviews)
        .where(eq(reviews.submissionId, submission.id))
        .orderBy(desc(reviews.startedAt))
        .limit(1);

      if (latestRev && latestRev.id !== finding.reviewId) {
        return {
          ok: false,
          status: 409,
          code: "stale_review",
          message: "This finding is from an older review. Run the review again.",
        };
      }

      // 5. Apply suggestion to document with stale content detection
      const applyRes = applyFindingToDocument(submission.normalized, finding);
      if (!applyRes.ok) {
        if (applyRes.code === "stale") {
          return {
            ok: false,
            status: 409,
            code: "stale_document",
            message: "The text changed since this review. Run the review again.",
          };
        }
        if (applyRes.code === "no_suggestion") {
          return {
            ok: false,
            status: 400,
            code: "bad_request",
            message: applyRes.message,
          };
        }
        return {
          ok: false,
          status: 404,
          code: "not_found",
          message: applyRes.message,
        };
      }

      // 6. Transition workflow status
      const nextStatus = transition(submission.status, "edit_content", user.role);
      if (!nextStatus.ok) {
        return { ok: false, status: 403, code: "forbidden", message: nextStatus.error };
      }

      // 7. Update submission and mark finding applied in the same transaction
      await tx
        .update(submissions)
        .set({
          normalized: applyRes.doc,
          status: nextStatus.status,
          updatedAt: new Date(),
        })
        .where(eq(submissions.id, submission.id));

      await tx
        .update(findings)
        .set({ state: "applied" })
        .where(eq(findings.id, finding.id));

      if (submission.status === "approved" && nextStatus.status === "draft") {
        await tx.insert(activityLog).values({
          submissionId: submission.id,
          actorId: user.id,
          action: "edit_after_approval",
          detail: "Applying a fix returned this to draft.",
        });
      }

      await tx.insert(activityLog).values({
        submissionId: submission.id,
        actorId: user.id,
        action: "finding_applied",
        detail: `Applied fix for ${finding.sourceCode}`,
      });

      return { ok: true, submissionId: submission.id };
    });

    if (!result.ok) {
      if (result.response) return result.response;
      return jsonError(result.code, result.message, result.status);
    }

    // Call startReview outside transaction
    const fastOnly = (process.env.REVIEW_AFTER_APPLY ?? "full") === "fast";
    const next = await startReview(result.submissionId, {
      fastOnly,
      skipReason: fastOnly ? "not_rerun_after_edit" : undefined,
    });

    return jsonOk({ reviewId: next.reviewId, deepStatus: next.deepStatus });
  } catch (err) {
    return toErrorResponse(err);
  }
}
