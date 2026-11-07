import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_BRAND_ID } from "@/lib/brand";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { embedGuideline } from "@/server/ai/embeddings";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { guidelineSections } from "@/server/db/schema";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  code: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/brand/sections/[id]">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const denied = forbidUnless(user, "brand.edit");
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const body = patchSchema.parse(await req.json());
    const [row] = await getDb()
      .update(guidelineSections)
      .set(body)
      .where(and(eq(guidelineSections.id, id), eq(guidelineSections.brandId, DEFAULT_BRAND_ID)))
      .returning();
    if (!row) return jsonError("not_found", "Section not found", 404);
    let warning: string | undefined;
    if (body.body) {
      const embedded = await embedGuideline(row.id, row.body);
      if (!embedded) {
        warning = "Saved, but embedding failed. Claim matching will use keyword search.";
      }
    }
    return jsonOk({ ...row, warning });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/brand/sections/[id]">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const denied = forbidUnless(user, "brand.edit");
  if (denied) return denied;
  const { id } = await ctx.params;
  await getDb().delete(guidelineSections).where(eq(guidelineSections.id, id));
  return jsonOk({ id });
}
