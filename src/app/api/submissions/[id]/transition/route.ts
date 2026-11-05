import { eq } from "drizzle-orm";
import { z } from "zod";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { SCORE_CONFIG } from "@/server/review/scoring";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { findings, submissions } from "@/server/db/schema";
import { latestReview, logActivity } from "@/server/review/orchestrator";
import { rowToFinding } from "@/server/review/map";
import { transition, type WorkflowAction } from "@/server/workflow/transitions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["submit", "approve", "request_changes"]),
  note: z.string().optional(),
});

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/submissions/[id]/transition">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const { id } = await ctx.params;
  try {
    const body = bodySchema.parse(await req.json());
    const permission =
      body.action === "submit"
        ? "submissions.submit"
        : body.action === "approve"
          ? "submissions.approve"
          : "submissions.request_changes";
    const db = getDb();
    const [row] = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
    if (!row) return jsonError("not_found", "Submission not found", 404);
    const denied = forbidUnless(user, permission, row.creatorId);
    if (denied) return denied;

    if (body.action === "submit") {
      const review = await latestReview(id);
      if (!review || !["done", "skipped", "failed"].includes(review.deepStatus)) {
        return jsonError(
          "not_ready",
          "Submit is blocked until a review has finished, skipped, or failed.",
        );
      }
      if ((review.score ?? 0) < SCORE_CONFIG.readyThreshold) {
        const dismissed = (
          await db.select().from(findings).where(eq(findings.reviewId, review.id))
        )
          .map(rowToFinding)
          .filter((f) => f.state === "dismissed");
        await logActivity(
          id,
          user.id,
          "submitted_below_threshold",
          `submitted below threshold with ${dismissed.length} dismissals and reasons`,
        );
      }
    }

    const result = transition(row.status, body.action as WorkflowAction, user.role);
    if (!result.ok) return jsonError("forbidden", result.error, 403);
    await db
      .update(submissions)
      .set({ status: result.status, updatedAt: new Date() })
      .where(eq(submissions.id, id));
    await logActivity(
      id,
      user.id,
      body.action,
      body.note?.trim() || `${user.name} ${body.action.replace("_", " ")}`,
    );
    return jsonOk({ status: result.status });
  } catch (err) {
    return toErrorResponse(err);
  }
}
