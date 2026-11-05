import { eq } from "drizzle-orm";
import { z } from "zod";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { embedClaim } from "@/server/ai/embeddings";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { approvedClaims } from "@/server/db/schema";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  code: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
});

export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/brand/claims/[id]">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const denied = forbidUnless(user, "brand.edit");
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const body = patchSchema.parse(await req.json());
    const [row] = await getDb()
      .update(approvedClaims)
      .set(body)
      .where(eq(approvedClaims.id, id))
      .returning();
    if (!row) return jsonError("not_found", "Claim not found", 404);
    if (body.text) await embedClaim(row.id, row.text);
    return jsonOk(row);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/brand/claims/[id]">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const denied = forbidUnless(user, "brand.edit");
  if (denied) return denied;
  const { id } = await ctx.params;
  await getDb().delete(approvedClaims).where(eq(approvedClaims.id, id));
  return jsonOk({ id });
}
