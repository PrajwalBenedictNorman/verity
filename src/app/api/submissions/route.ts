import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_BRAND_ID } from "@/lib/brand";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { reviews, submissions, users } from "@/server/db/schema";
import { kindFromFilename, normalize } from "@/server/ingest/normalize";
import { saveStoredFile } from "@/server/storage";
import { logActivity } from "@/server/review/orchestrator";

export const dynamic = "force-dynamic";

const jsonSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
});

export async function GET() {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const db = getDb();
  const rows = await db
    .select({
      id: submissions.id,
      title: submissions.title,
      status: submissions.status,
      updatedAt: submissions.updatedAt,
      creatorId: submissions.creatorId,
      creatorName: users.name,
    })
    .from(submissions)
    .innerJoin(users, eq(users.id, submissions.creatorId))
    .orderBy(desc(submissions.updatedAt));

  const reviewRows = await db.select().from(reviews);
  const latest = new Map<string, (typeof reviewRows)[number]>();
  for (const r of reviewRows) {
    const prev = latest.get(r.submissionId);
    if (!prev || r.startedAt > prev.startedAt) latest.set(r.submissionId, r);
  }

  const data = rows
    .filter(
      (row) =>
        forbidUnless(user, "submissions.read", row.creatorId) === null,
    )
    .map((row) => ({
      ...row,
      score: latest.get(row.id)?.score ?? null,
    }));
  return jsonOk(data);
}

export async function POST(req: Request) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const denied = forbidUnless(user, "submissions.create");
  if (denied) return denied;

  try {
    const contentType = req.headers.get("content-type") ?? "";
    let title: string;
    let kind: "text" | "pdf" | "docx" | "image" = "text";
    let text: string | undefined;
    let buffer: Buffer | undefined;
    let filename: string | undefined;
    let stored: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      title = String(form.get("title") ?? "").trim();
      if (!title) return jsonError("bad_request", "Title is required");
      const file = form.get("file");
      const pasted = form.get("text");
      if (file instanceof File && file.size > 0) {
        filename = file.name;
        buffer = Buffer.from(await file.arrayBuffer());
        const detected = kindFromFilename(file.name, file.type);
        if (!detected) {
          return jsonError("bad_request", "Upload a text, PDF, DOCX, or image file.");
        }
        kind = detected;
        stored = await saveStoredFile(
          `submissions/${crypto.randomUUID()}/${file.name}`,
          buffer,
        );
        if (kind === "text") text = buffer.toString("utf8");
      } else if (typeof pasted === "string" && pasted.trim()) {
        text = pasted;
        kind = "text";
      } else {
        return jsonError("bad_request", "Provide text or a file.");
      }
    } else {
      const body = jsonSchema.parse(await req.json());
      title = body.title;
      text = body.text;
      kind = "text";
    }

    const normalized = await normalize({ kind, text, buffer, filename });
    const db = getDb();
    const [row] = await db
      .insert(submissions)
      .values({
        brandId: DEFAULT_BRAND_ID,
        creatorId: user.id,
        title,
        status: "draft",
        sourceKind: kind,
        originalFilePath: stored,
        normalized,
      })
      .returning();
    if (!row) return jsonError("internal", "Could not create submission", 500);
    await logActivity(row.id, user.id, "created", `Created “${title}”`);
    return jsonOk({ id: row.id }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
