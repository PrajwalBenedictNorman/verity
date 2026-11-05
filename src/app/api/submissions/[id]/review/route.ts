import { eq } from "drizzle-orm";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { submissions } from "@/server/db/schema";
import { logActivity, startReview } from "@/server/review/orchestrator";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/submissions/[id]/review">,
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
    const result = await startReview(id);
    await logActivity(id, user.id, "review_started", `Review ${result.reviewId} started`);
    return jsonOk({
      reviewId: result.reviewId,
      fast: result.fast,
      deepStatus: result.deepStatus,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
