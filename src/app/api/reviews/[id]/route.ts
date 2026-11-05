import { eq } from "drizzle-orm";
import { jsonError, jsonOk } from "@/lib/errors";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { findings, reviews, submissions } from "@/server/db/schema";
import { rowToFinding } from "@/server/review/map";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/reviews/[id]">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const { id } = await ctx.params;
  const db = getDb();
  const [review] = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
  if (!review) return jsonError("not_found", "Review not found", 404);
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, review.submissionId))
    .limit(1);
  if (!submission) return jsonError("not_found", "Submission not found", 404);
  const denied = forbidUnless(user, "submissions.read", submission.creatorId);
  if (denied) return denied;
  const rows = await db.select().from(findings).where(eq(findings.reviewId, review.id));
  return jsonOk({
    deepStatus: review.deepStatus,
    score: review.score,
    findings: rows.map(rowToFinding),
    discarded: review.discardedCount,
    verified: review.verifiedClaimCodes,
    disclosure: review.disclosure,
    log: review.disclosure.log ?? [],
    fastMs: review.fastMs,
    deepMs: review.deepMs,
  });
}
