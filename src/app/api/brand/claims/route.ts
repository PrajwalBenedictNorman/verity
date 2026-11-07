import { eq } from "drizzle-orm";
import { z } from "zod";
import { DEFAULT_BRAND_ID } from "@/lib/brand";
import { jsonError, jsonOk, toErrorResponse } from "@/lib/errors";
import { embedClaim } from "@/server/ai/embeddings";
import { forbidUnless, requireApiUser } from "@/server/auth/api";
import { getDb } from "@/server/db/client";
import { approvedClaims } from "@/server/db/schema";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  code: z.string().min(1),
  text: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export async function GET() {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const denied = forbidUnless(user, "brand.read");
  if (denied) return denied;
  const rows = await getDb()
    .select()
    .from(approvedClaims)
    .where(eq(approvedClaims.brandId, DEFAULT_BRAND_ID));
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
      .insert(approvedClaims)
      .values({ brandId: DEFAULT_BRAND_ID, ...body })
      .returning();
    if (!row) return jsonError("internal", "Could not create claim", 500);
    const embedded = await embedClaim(row.id, row.text);
    const warning = embedded
      ? undefined
      : "Saved, but embedding failed. Claim matching will use keyword search.";
    return jsonOk({ ...row, warning }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
