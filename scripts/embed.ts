import "dotenv/config";
import { eq, isNull } from "drizzle-orm";
import { getDb, getSql } from "@/server/db/client";
import { approvedClaims, guidelineSections } from "@/server/db/schema";
import { embeddingsConfigured, getAdapter } from "@/server/ai/adapter";
import { withRetries } from "@/server/review/deep/retry";
import { AiError, userMessageFor } from "@/server/ai/errors";

async function main() {
  const db = getDb();

  const missingSections = await db
    .select()
    .from(guidelineSections)
    .where(isNull(guidelineSections.embedding));

  const missingClaims = await db
    .select()
    .from(approvedClaims)
    .where(isNull(approvedClaims.embedding));

  const total = missingSections.length + missingClaims.length;
  if (total === 0) {
    console.log("All claims and guideline sections already have embeddings.");
    await getSql().end({ timeout: 5 });
    return;
  }

  console.log(
    `Found ${total} items with missing embeddings (${missingClaims.length} claims, ${missingSections.length} guideline sections).`,
  );

  if (!embeddingsConfigured()) {
    console.error(
      "Embeddings not configured. Ensure AI_ENABLED!=false, AI_BASE_URL, AI_API_KEY, and EMBEDDING_MODEL are set.",
    );
    await getSql().end({ timeout: 1 });
    process.exit(1);
  }

  const adapter = getAdapter();
  const EMBED_BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE ?? 32);
  let embedded = 0;

  try {
    for (let i = 0; i < missingSections.length; i += EMBED_BATCH_SIZE) {
      const batch = missingSections.slice(i, i + EMBED_BATCH_SIZE);
      const res = await withRetries(() =>
        adapter.embed(batch.map((s) => s.body)),
      );
      for (let j = 0; j < batch.length; j++) {
        const v = res.vectors[j];
        if (v) {
          await db
            .update(guidelineSections)
            .set({ embedding: v })
            .where(eq(guidelineSections.id, batch[j].id));
          embedded++;
        }
      }
    }

    for (let i = 0; i < missingClaims.length; i += EMBED_BATCH_SIZE) {
      const batch = missingClaims.slice(i, i + EMBED_BATCH_SIZE);
      const res = await withRetries(() =>
        adapter.embed(batch.map((c) => c.text)),
      );
      for (let j = 0; j < batch.length; j++) {
        const v = res.vectors[j];
        if (v) {
          await db
            .update(approvedClaims)
            .set({ embedding: v })
            .where(eq(approvedClaims.id, batch[j].id));
          embedded++;
        }
      }
    }

    console.log(`Embeddings complete: ${embedded}/${total} embedded.`);
    await getSql().end({ timeout: 5 });
  } catch (err) {
    const code = err instanceof AiError ? err.code : "unknown";
    const msg = userMessageFor(code);
    console.error(`Embedding failed: ${msg}`);
    await getSql().end({ timeout: 1 });
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  try {
    await getSql().end({ timeout: 1 });
  } catch {
    // ignore
  }
  process.exit(1);
});
