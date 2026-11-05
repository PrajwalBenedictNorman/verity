import { eq } from "drizzle-orm";
import { z } from "zod";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { findings, reviews, submissions } from "@/server/db/schema";
import { logActivity, latestReview } from "@/server/review/orchestrator";
import { rowToFinding } from "@/server/review/map";
import { scoreFindings } from "@/server/review/scoring";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ reason: z.string().min(3) });

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/findings/[id]/dismiss">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const { id } = await ctx.params;
  try {
    const { reason } = bodySchema.parse(await req.json());
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
    const denied = forbidUnless(user, "findings.dismiss", submission.creatorId);
    if (denied) return denied;
    await db
      .update(findings)
      .set({ state: "dismissed", dismissReason: reason })
      .where(eq(findings.id, finding.id));
    const latest = await latestReview(submission.id);
    if (latest) {
      const all = await db.select().from(findings).where(eq(findings.reviewId, latest.id));
      await db
        .update(reviews)
        .set({ score: scoreFindings(all.map(rowToFinding)) })
        .where(eq(reviews.id, latest.id));
    }
    await logActivity(submission.id, user.id, "finding_dismissed", reason);
    return jsonOk({ id, state: "dismissed" });
  } catch (err) {
    return toErrorResponse(err);
  }
}
