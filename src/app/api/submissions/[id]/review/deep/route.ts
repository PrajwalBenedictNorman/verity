import { eq } from "drizzle-orm";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { reviews, submissions } from "@/server/db/schema";
import { latestReview, logActivity, runDeep } from "@/server/review/orchestrator";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const { id } = await ctx.params;
  try {
    const db = getDb();
    const [row] = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
    if (!row) return jsonError("not_found", "Submission not found", 404);
    const denied = forbidUnless(user, "submissions.review", row.creatorId);
    if (denied) return denied;

    const review = await latestReview(id);
    if (!review) return jsonError("not_found", "No existing review found to retry", 404);

    await db
      .update(reviews)
      .set({
        deepStatus: "running",
        finishedAt: null,
      })
      .where(eq(reviews.id, review.id));

    void runDeep(review.id).catch((err) =>
      console.error("retried deep tier failed", err),
    );

    await logActivity(
      id,
      user.id,
      "deep_review_retried",
      `Deep review for ${review.id} retried`,
    );

    return jsonOk({
      reviewId: review.id,
      deepStatus: "running",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
