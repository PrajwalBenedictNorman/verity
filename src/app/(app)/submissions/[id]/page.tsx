import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { auth } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import { activityLog, findings, submissions, users } from "@/server/db/schema";
import { latestReview } from "@/server/review/orchestrator";
import { rowToFinding } from "@/server/review/map";
import { ReviewScreen } from "@/components/review/ReviewScreen";

export const dynamic = "force-dynamic";

export default async function SubmissionPage({
  params,
}: PageProps<"/submissions/[id]">) {
  const session = await auth();
  if (!session?.user) return null;
  const { id } = await params;
  const db = getDb();
  const [row] = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
  if (!row) notFound();
  if (
    !can({
      role: session.user.role,
      permission: "submissions.read",
      userId: session.user.id,
      ownerId: row.creatorId,
    })
  ) {
    notFound();
  }
  const [creator] = await db.select().from(users).where(eq(users.id, row.creatorId)).limit(1);
  const review = await latestReview(row.id);
  const reviewFindings = review
    ? (await db.select().from(findings).where(eq(findings.reviewId, review.id))).map(rowToFinding)
    : [];
  const activity = await db
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
  const approvedBy = [...activity]
    .reverse()
    .find((entry) => entry.action === "approve")?.actorName;

  return (
    <ReviewScreen
      role={session.user.role}
      userId={session.user.id}
      initial={{
        submission: {
          id: row.id,
          title: row.title,
          status: row.status,
          sourceKind: row.sourceKind,
          creatorId: row.creatorId,
          normalized: row.normalized,
        },
        creatorName: creator?.name ?? "Unknown",
        approvedBy: approvedBy ?? null,
        activity,
        latestReview: review
          ? {
              id: review.id,
              deepStatus: review.deepStatus,
              score: review.score,
              discarded: review.discardedCount,
              verified: review.verifiedClaimCodes,
              disclosure: review.disclosure,
            }
          : null,
        findings: reviewFindings,
      }}
    />
  );
}
