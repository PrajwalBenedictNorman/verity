import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_BRAND_ID } from "@/lib/brand";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { brandColours } from "@/server/db/schema";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  hex: z.string().min(4).optional(),
  maxDeviation: z.number().int().optional(),
});

export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/brand/colours/[id]">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const denied = forbidUnless(user, "brand.edit");
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const body = patchSchema.parse(await req.json());
    const [row] = await getDb()
      .update(brandColours)
      .set(body)
      .where(
        and(
          eq(brandColours.id, id),
          eq(brandColours.brandId, DEFAULT_BRAND_ID),
        ),
      )
      .returning();
    if (!row) return jsonError("not_found", "Colour not found", 404);
    return jsonOk(row);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/brand/colours/[id]">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const denied = forbidUnless(user, "brand.edit");
  if (denied) return denied;
  const { id } = await ctx.params;
  await getDb()
    .delete(brandColours)
    .where(
      and(
        eq(brandColours.id, id),
        eq(brandColours.brandId, DEFAULT_BRAND_ID),
      ),
    );
  return jsonOk({ id });
}
