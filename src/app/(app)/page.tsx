import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { reviews, submissions, users } from "@/server/db/schema";
import { can } from "@/server/auth/permissions";

export default async function SubmissionsPage() {
  const session = await auth();
  if (!session?.user) return null;
  const db = getDb();
  const rows = await db
    .select({
      id: submissions.id,
      title: submissions.title,
      status: submissions.status,
      updatedAt: submissions.updatedAt,
      creatorName: users.name,
      creatorId: submissions.creatorId,
    })
    .from(submissions)
    .innerJoin(users, eq(users.id, submissions.creatorId))
    .orderBy(desc(submissions.updatedAt));

  const visible = rows.filter((row) =>
    can({
      role: session.user.role,
      permission: "submissions.read",
      userId: session.user.id,
      ownerId: row.creatorId,
    }),
  );

  const latestScores = await db
    .select({
      submissionId: reviews.submissionId,
      score: reviews.score,
      startedAt: reviews.startedAt,
    })
    .from(reviews);

  const scoreBySubmission = new Map<string, number | null>();
  const startedBySubmission = new Map<string, Date>();
  for (const r of latestScores) {
    const prev = startedBySubmission.get(r.submissionId);
    if (!prev || r.startedAt > prev) {
      startedBySubmission.set(r.submissionId, r.startedAt);
      scoreBySubmission.set(r.submissionId, r.score);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Submissions</h1>
        {can({
          role: session.user.role,
          permission: "submissions.create",
          userId: session.user.id,
        }) ? (
          <Link
            href="/submissions/new"
            className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white"
          >
            New submission
          </Link>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-panel">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Creator</th>
              <th className="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-muted" colSpan={5}>
                  No submissions yet.
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/submissions/${row.id}`} className="text-brand hover:underline">
                      {row.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 capitalize">{row.status.replace("_", " ")}</td>
                  <td className="px-4 py-3">{scoreBySubmission.get(row.id) ?? "—"}</td>
                  <td className="px-4 py-3">{row.creatorName}</td>
                  <td className="px-4 py-3">
                    {row.updatedAt.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
