import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { approvedClaims, guidelineSections } from "@/server/db/schema";
import { embeddingsConfigured, getAdapter } from "./adapter";
import { AiError, userMessageFor } from "./errors";
import { withRetries } from "../review/deep/retry";

export async function embedTexts(texts: string[]) {
  if (!embeddingsConfigured() || texts.length === 0) return null;
  const adapter = getAdapter();
  try {
    return await withRetries(() => adapter.embed(texts));
  } catch (err) {
    console.error("embed failed", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function embedGuideline(id: string, body: string): Promise<boolean> {
  const result = await embedTexts([body]);
  if (!result?.vectors[0]) return false;
  await getDb()
    .update(guidelineSections)
    .set({ embedding: result.vectors[0] })
    .where(eq(guidelineSections.id, id));
  return true;
}

export async function embedClaim(id: string, text: string): Promise<boolean> {
  const result = await embedTexts([text]);
  if (!result?.vectors[0]) return false;
  await getDb()
    .update(approvedClaims)
    .set({ embedding: result.vectors[0] })
    .where(eq(approvedClaims.id, id));
  return true;
}

export async function embedBrand(brandId: string): Promise<{
  ok: boolean;
  embedded: number;
  total: number;
  error?: string;
}> {
  const db = getDb();
  const sections = await db
    .select()
    .from(guidelineSections)
    .where(eq(guidelineSections.brandId, brandId));
  const claims = await db
    .select()
    .from(approvedClaims)
    .where(eq(approvedClaims.brandId, brandId));

  const total = sections.length + claims.length;
  if (total === 0) {
    return { ok: true, embedded: 0, total: 0 };
  }

  if (!embeddingsConfigured()) {
    return {
      ok: false,
      embedded: 0,
      total,
      error: "Embeddings are disabled or not configured.",
    };
  }

  const adapter = getAdapter();
  const EMBED_BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE ?? 32);

  let embedded = 0;
  try {
    for (let i = 0; i < sections.length; i += EMBED_BATCH_SIZE) {
      const batch = sections.slice(i, i + EMBED_BATCH_SIZE);
      const res = await withRetries(() =>
        adapter.embed(batch.map((s) => s.body)),
      );
      for (let j = 0; j < batch.length; j++) {
        const vector = res.vectors[j];
        if (vector) {
          await db
            .update(guidelineSections)
            .set({ embedding: vector })
            .where(eq(guidelineSections.id, batch[j].id));
          embedded++;
        }
      }
    }

    for (let i = 0; i < claims.length; i += EMBED_BATCH_SIZE) {
      const batch = claims.slice(i, i + EMBED_BATCH_SIZE);
      const res = await withRetries(() =>
        adapter.embed(batch.map((c) => c.text)),
      );
      for (let j = 0; j < batch.length; j++) {
        const vector = res.vectors[j];
        if (vector) {
          await db
            .update(approvedClaims)
            .set({ embedding: vector })
            .where(eq(approvedClaims.id, batch[j].id));
          embedded++;
        }
      }
    }

    return { ok: true, embedded, total };
  } catch (err) {
    const code = err instanceof AiError ? err.code : "unknown";
    const safeMsg = userMessageFor(code);
    console.error("embedBrand failed", { brandId, code });
    return { ok: false, embedded, total, error: safeMsg };
  }
}
