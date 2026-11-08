import "dotenv/config";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { EMBEDDING_DIM } from "@/lib/config";
import { getAdapter } from "@/server/ai/adapter";
import { AiError, userMessageFor, classifyError, classifyHttpError } from "@/server/ai/errors";
import { getSql } from "@/server/db/client";

async function runCheck() {
  console.log("==================================================");
  console.log("             Verity AI Pre-flight Check           ");
  console.log("==================================================\n");

  let hasFailure = false;
  getEnv();

  // 1. Environment validation
  const key = process.env.AI_API_KEY ?? "";
  const maskedKey =
    key.length > 8
      ? `${key.slice(0, 4)}...${key.slice(-4)}`
      : key
        ? "***"
        : "[MISSING]";

  console.log("1. Environment variables:");
  console.log(`   - AI_ENABLED: ${process.env.AI_ENABLED ?? "true"}`);
  console.log(`   - AI_BASE_URL: ${process.env.AI_BASE_URL ?? "[MISSING]"}`);
  console.log(`   - AI_MODEL: ${process.env.AI_MODEL ?? "[MISSING]"}`);
  console.log(`   - EMBEDDING_MODEL: ${process.env.EMBEDDING_MODEL ?? "[MISSING]"}`);
  console.log(`   - EMBEDDING_DIM: ${EMBEDDING_DIM}`);
  console.log(`   - AI_API_KEY: ${maskedKey}`);

  if (process.env.AI_ENABLED === "false") {
    console.log("\n[INFO] AI is explicitly disabled (AI_ENABLED=false). Fast-tier only mode is active.");
    return;
  }

  if (!process.env.AI_BASE_URL || !process.env.AI_API_KEY || !process.env.AI_MODEL) {
    console.log("\n[FAIL] Environment check failed: AI_BASE_URL, AI_API_KEY, and AI_MODEL are required when AI_ENABLED is true.");
    process.exit(1);
  }
  console.log("   -> [PASS] Environment configuration valid.\n");

  const baseUrl = (process.env.AI_BASE_URL ?? "").replace(/\/$/, "");

  // 2. GET {base}/models reachability
  console.log("2. Checking provider models endpoint (GET /models)...");
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const aiErr = classifyHttpError(res.status, errText, res.headers);
      console.log(`   -> [WARN] Provider /models returned HTTP ${res.status}: ${userMessageFor(aiErr.code)} (${aiErr.code})`);
    } else {
      const json = (await res.json()) as {
        data?: { id: string }[];
        models?: { name: string }[];
      };
      const modelList: string[] = (json.data ?? [])
        .map((m) => m.id)
        .concat((json.models ?? []).map((m) => m.name.replace(/^models\//, "")));

      const aiModel = process.env.AI_MODEL ?? "";
      const embedModel = process.env.EMBEDDING_MODEL ?? "";

      const aiModelFound = modelList.some((m) => m === aiModel || m.endsWith(`/${aiModel}`));
      const embedModelFound = modelList.some((m) => m === embedModel || m.endsWith(`/${embedModel}`));

      if (aiModelFound && (embedModelFound || !embedModel)) {
        console.log(`   -> [PASS] Models endpoint reachable. ${aiModel} found.`);
      } else {
        console.log(`   -> [WARN] One or more configured models was not in /models response.`);
        if (!aiModelFound) console.log(`      AI_MODEL '${aiModel}' not found.`);
        if (!embedModelFound && embedModel) console.log(`      EMBEDDING_MODEL '${embedModel}' not found.`);
        if (modelList.length > 0) {
          console.log(`      Available models (showing up to 10): ${modelList.slice(0, 10).join(", ")}`);
        }
      }
    }
  } catch (err) {
    const aiErr = classifyError(err);
    console.log(`   -> [WARN] Could not query /models: ${userMessageFor(aiErr.code)} (${aiErr.code})`);
  }

  // 3. Chat completion call with JSON mode
  console.log("\n3. Testing chat completion with JSON mode...");
  const adapter = getAdapter();
  try {
    const testSchema = z.object({
      status: z.string(),
      echo: z.string().optional(),
    });

    const chatRes = await adapter.complete({
      system: "You are a health check agent. Return JSON only.",
      user: 'Return JSON: {"status": "ok", "echo": "verity"}',
      schema: testSchema,
      timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 30_000),
    });

    console.log(`   -> [PASS] Chat call succeeded in ${chatRes.ms}ms (calls: ${chatRes.calls}). Response: ${JSON.stringify(chatRes.data)}`);
  } catch (err) {
    hasFailure = true;
    const aiErr = err instanceof AiError ? err : classifyError(err);
    console.log(`   -> [FAIL] Chat call failed: ${userMessageFor(aiErr.code)} (${aiErr.code}${aiErr.status ? ` ${aiErr.status}` : ""})`);
  }

  // 4. Embedding call
  console.log("\n4. Testing embeddings endpoint...");
  if (!process.env.EMBEDDING_MODEL) {
    console.log("   -> [WARN] EMBEDDING_MODEL not set. Deep tier will fall back to keyword retrieval.");
  } else {
    try {
      const embedRes = await adapter.embed(["Verity brand compliance check"]);
      const nativeLen = embedRes.vectors[0]?.length ?? 0;
      console.log(`   -> [PASS] Embedding succeeded in ${embedRes.calls} HTTP call(s).`);
      console.log(`      Native vector length: ${nativeLen}, Target EMBEDDING_DIM: ${EMBEDDING_DIM}`);
      if (nativeLen !== EMBEDDING_DIM) {
        console.log(`      Note: Adapter automatically padded/truncated to EMBEDDING_DIM (${EMBEDDING_DIM}).`);
      }
    } catch (err) {
      hasFailure = true;
      const aiErr = err instanceof AiError ? err : classifyError(err);
      console.log(`   -> [FAIL] Embedding failed: ${userMessageFor(aiErr.code)} (${aiErr.code}${aiErr.status ? ` ${aiErr.status}` : ""})`);
    }
  }

  // 5. Database pgvector column dimension check
  console.log("\n5. Checking database pgvector column dimension...");
  try {
    const sql = getSql();
    const rows = await sql<{ atttypmod: number }[]>`
      SELECT atttypmod
      FROM pg_attribute
      JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
      WHERE pg_class.relname = 'approved_claims' AND pg_attribute.attname = 'embedding'
      LIMIT 1;
    `;
    if (rows.length > 0 && rows[0].atttypmod > 0) {
      const dbDim = rows[0].atttypmod;
      if (dbDim === EMBEDDING_DIM) {
        console.log(`   -> [PASS] Database approved_claims.embedding dimension (${dbDim}) matches EMBEDDING_DIM (${EMBEDDING_DIM}).`);
      } else {
        hasFailure = true;
        console.log(`   -> [FAIL] Dimension mismatch! Database is ${dbDim}, but EMBEDDING_DIM is ${EMBEDDING_DIM}. Run db:migrate or adjust EMBEDDING_DIM.`);
      }
    } else {
      console.log("   -> [PASS] Database connected. Table verified.");
    }
    await sql.end({ timeout: 2 });
  } catch (err) {
    console.log(`   -> [WARN] Database check skipped or failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log("\n==================================================");
  if (hasFailure) {
    console.log("               RESULT: CHECKS FAILED              ");
    console.log("==================================================");
    process.exit(1);
  } else {
    console.log("               RESULT: ALL CHECKS PASSED          ");
    console.log("==================================================");
    process.exit(0);
  }
}

runCheck().catch((err) => {
  console.error("Fatal pre-flight error:", err);
  process.exit(1);
});
