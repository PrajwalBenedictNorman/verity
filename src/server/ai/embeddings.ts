import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { approvedClaims, guidelineSections } from "@/server/db/schema";
import { aiConfigured, embeddingsConfigured, getAdapter } from "./adapter";

export async function embedTexts(texts: string[]) {
  if (!embeddingsConfigured()) return null;
  const adapter = getAdapter();
  try {
    return await adapter.embed(texts);
  } catch (err) {
    console.error("embed failed", err);
    return null;
  }
}

export async function embedGuideline(id: string, body: string) {
  const result = await embedTexts([body]);
  if (!result?.vectors[0]) return;
  await getDb()
    .update(guidelineSections)
    .set({ embedding: result.vectors[0] })
    .where(eq(guidelineSections.id, id));
}

export async function embedClaim(id: string, text: string) {
  const result = await embedTexts([text]);
  if (!result?.vectors[0]) return;
  await getDb()
    .update(approvedClaims)
    .set({ embedding: result.vectors[0] })
    .where(eq(approvedClaims.id, id));
}

export async function embedBrand(brandId: string) {
  if (!embeddingsConfigured() || !aiConfigured()) return;
  const db = getDb();
  const sections = await db
    .select()
    .from(guidelineSections)
    .where(eq(guidelineSections.brandId, brandId));
  const claims = await db
    .select()
    .from(approvedClaims)
    .where(eq(approvedClaims.brandId, brandId));
  const texts = [...sections.map((s) => s.body), ...claims.map((c) => c.text)];
  const result = await embedTexts(texts);
  if (!result) return;
  let i = 0;
  for (const section of sections) {
    const vector = result.vectors[i++];
    if (vector) {
      await db
        .update(guidelineSections)
        .set({ embedding: vector })
        .where(eq(guidelineSections.id, section.id));
    }
  }
  for (const claim of claims) {
    const vector = result.vectors[i++];
    if (vector) {
      await db
        .update(approvedClaims)
        .set({ embedding: vector })
        .where(eq(approvedClaims.id, claim.id));
    }
  }
}
