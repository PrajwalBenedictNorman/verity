import { eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_BRAND_ID } from "@/lib/brand";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { embedGuideline } from "@/server/ai/embeddings";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { guidelineSections } from "@/server/db/schema";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  code: z.string().min(1),
  category: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
});

export async function GET() {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const denied = forbidUnless(user, "brand.read");
  if (denied) return denied;
  const rows = await getDb()
    .select()
    .from(guidelineSections)
    .where(eq(guidelineSections.brandId, DEFAULT_BRAND_ID));
  return jsonOk(rows);
}

export async function POST(req: Request) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const denied = forbidUnless(user, "brand.edit");
  if (denied) return denied;
  try {
    const body = createSchema.parse(await req.json());
    const [row] = await getDb()
      .insert(guidelineSections)
      .values({ brandId: DEFAULT_BRAND_ID, ...body })
      .returning();
    if (!row) return jsonError("internal", "Could not create section", 500);
    await embedGuideline(row.id, row.body);
    return jsonOk(row, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
