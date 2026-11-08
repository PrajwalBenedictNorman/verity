import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { RETRIEVAL_MIN_SIM } from "@/lib/config";
import { getDb } from "@/server/db/client";
import { approvedClaims, guidelineSections } from "@/server/db/schema";
import { embeddingsConfigured, getAdapter } from "@/server/ai/adapter";

export type Retrieved = {
  code: string;
  text: string;
  similarity: number;
};

export type RetrievalMode = "vector" | "keyword";

async function keywordClaims(brandId: string, query: string, k: number) {
  const db = getDb();
  const rows = await db
    .select({
      code: approvedClaims.code,
      text: approvedClaims.text,
      rank: sql<number>`ts_rank(to_tsvector('english', ${approvedClaims.text}), plainto_tsquery('english', ${query}))`,
    })
    .from(approvedClaims)
    .where(eq(approvedClaims.brandId, brandId))
    .orderBy(
      sql`ts_rank(to_tsvector('english', ${approvedClaims.text}), plainto_tsquery('english', ${query})) desc`,
    )
    .limit(k);
  return rows
    .filter((r) => (r.rank ?? 0) > 0)
    .map((r) => ({ code: r.code, text: r.text, similarity: Number(r.rank) }));
}

async function keywordGuidelines(brandId: string, query: string, k: number) {
  const db = getDb();
  const rows = await db
    .select({
      code: guidelineSections.code,
      text: guidelineSections.body,
      rank: sql<number>`ts_rank(to_tsvector('english', ${guidelineSections.body}), plainto_tsquery('english', ${query}))`,
    })
    .from(guidelineSections)
    .where(
      and(
        eq(guidelineSections.brandId, brandId),
        inArray(guidelineSections.category, ["Claims", "Voice"]),
      ),
    )
    .orderBy(
      sql`ts_rank(to_tsvector('english', ${guidelineSections.body}), plainto_tsquery('english', ${query})) desc`,
    )
    .limit(k);
  return rows
    .filter((r) => (r.rank ?? 0) > 0)
    .map((r) => ({ code: r.code, text: r.text, similarity: Number(r.rank) }));
}

async function vectorClaims(brandId: string, vector: number[], k: number) {
  const db = getDb();
  const literal = `[${vector.join(",")}]`;
  const rows = await db
    .select({
      code: approvedClaims.code,
      text: approvedClaims.text,
      distance: sql<number>`${approvedClaims.embedding} <=> ${literal}::vector`,
    })
    .from(approvedClaims)
    .where(and(eq(approvedClaims.brandId, brandId), isNotNull(approvedClaims.embedding)))
    .orderBy(sql`${approvedClaims.embedding} <=> ${literal}::vector`)
    .limit(k);
  return rows
    .map((r) => ({
      code: r.code,
      text: r.text,
      similarity: 1 - Number(r.distance),
    }))
    .filter((r) => r.similarity >= RETRIEVAL_MIN_SIM);
}

async function vectorGuidelines(brandId: string, vector: number[], k: number) {
  const db = getDb();
  const literal = `[${vector.join(",")}]`;
  const rows = await db
    .select({
      code: guidelineSections.code,
      text: guidelineSections.body,
      distance: sql<number>`${guidelineSections.embedding} <=> ${literal}::vector`,
    })
    .from(guidelineSections)
    .where(
      and(
        eq(guidelineSections.brandId, brandId),
        inArray(guidelineSections.category, ["Claims", "Voice"]),
        isNotNull(guidelineSections.embedding),
      ),
    )
    .orderBy(sql`${guidelineSections.embedding} <=> ${literal}::vector`)
    .limit(k);
  return rows
    .map((r) => ({
      code: r.code,
      text: r.text,
      similarity: 1 - Number(r.distance),
    }))
    .filter((r) => r.similarity >= RETRIEVAL_MIN_SIM);
}

export async function retrieveForSentence(
  brandId: string,
  sentence: string,
  vector?: number[] | null,
): Promise<{
  claims: Retrieved[];
  guidelines: Retrieved[];
  mode: RetrievalMode;
  externalCalls: number;
}> {
  if (vector) {
    const [claims, guidelines] = await Promise.all([
      vectorClaims(brandId, vector, 3),
      vectorGuidelines(brandId, vector, 3),
    ]);
    if (claims.length + guidelines.length > 0) {
      return { claims, guidelines, mode: "vector", externalCalls: 0 };
    }
    return {
      claims: await keywordClaims(brandId, sentence, 3),
      guidelines: await keywordGuidelines(brandId, sentence, 3),
      mode: "keyword",
      externalCalls: 0,
    };
  }

  if (vector === null) {
    const [claims, guidelines] = await Promise.all([
      keywordClaims(brandId, sentence, 3),
      keywordGuidelines(brandId, sentence, 3),
    ]);
    return { claims, guidelines, mode: "keyword", externalCalls: 0 };
  }

  if (embeddingsConfigured()) {
    try {
      const adapter = getAdapter();
      const { vectors } = await adapter.embed([sentence]);
      const v = vectors[0];
      if (v) {
        const [claims, guidelines] = await Promise.all([
          vectorClaims(brandId, v, 3),
          vectorGuidelines(brandId, v, 3),
        ]);
        if (claims.length + guidelines.length > 0) {
          return { claims, guidelines, mode: "vector", externalCalls: 1 };
        }
        return {
          claims: await keywordClaims(brandId, sentence, 3),
          guidelines: await keywordGuidelines(brandId, sentence, 3),
          mode: "keyword",
          externalCalls: 1,
        };
      }
    } catch {
      // ignore and fall back to keyword
    }
  }

  const [claims, guidelines] = await Promise.all([
    keywordClaims(brandId, sentence, 3),
    keywordGuidelines(brandId, sentence, 3),
  ]);
  return { claims, guidelines, mode: "keyword", externalCalls: 0 };
}
