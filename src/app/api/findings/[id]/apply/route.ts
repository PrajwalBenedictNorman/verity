import { eq } from "drizzle-orm";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { findings, reviews, submissions } from "@/server/db/schema";
import { logActivity, startReview } from "@/server/review/orchestrator";
import { transition } from "@/server/workflow/transitions";
import type { NormalizedDocument } from "@/server/ingest/types";

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
    const [finding] = await db.select().from(findings).where(eq(findings.id, id)).limit(1);
    if (!finding) return jsonError("not_found", "Finding not found", 404);
    const [review] = await db.select().from(reviews).where(eq(reviews.id, finding.reviewId)).limit(1);
    if (!review) return jsonError("not_found", "Review not found", 404);
    const [submission] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, review.submissionId))
      .limit(1);
    if (!submission) return jsonError("not_found", "Submission not found", 404);
    const denied = forbidUnless(user, "findings.apply", submission.creatorId);
    if (denied) return denied;
    if (submission.sourceKind !== "text") {
      return jsonError(
        "unsupported",
        "Apply fix works on pasted text. Copy the suggestion for files.",
        409,
      );
    }
    if (!finding.suggestion) {
      return jsonError("bad_request", "This finding has no suggestion to apply.");
    }
    const doc = submission.normalized as NormalizedDocument;
    const block = doc.blocks.find((b) => b.id === finding.blockId);
    if (!block) return jsonError("not_found", "Block not found", 404);
    block.text =
      block.text.slice(0, finding.startOffset) +
      finding.suggestion +
      block.text.slice(finding.endOffset);
    doc.stats.chars = doc.blocks.reduce((n, b) => n + b.text.length, 0);
    const nextStatus = transition(submission.status, "edit_content", user.role);
    if (!nextStatus.ok) {
      return jsonError("forbidden", nextStatus.error, 403);
    }
    await db
      .update(submissions)
      .set({
        normalized: doc,
        status: nextStatus.status,
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, submission.id));
    await db.update(findings).set({ state: "applied" }).where(eq(findings.id, finding.id));
    if (submission.status === "approved" && nextStatus.status === "draft") {
      await logActivity(
        submission.id,
        user.id,
        "edit_after_approval",
        "Applying a fix returned this to draft.",
      );
    }
    await logActivity(
      submission.id,
      user.id,
      "finding_applied",
      `Applied fix for ${finding.sourceCode}`,
    );
    const next = await startReview(submission.id);
    return jsonOk({ reviewId: next.reviewId, deepStatus: next.deepStatus });
  } catch (err) {
    return toErrorResponse(err);
  }
}
