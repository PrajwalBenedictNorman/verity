import { jsonOk } from "@/lib/errors";
import { aiConfigured } from "@/server/ai/adapter";
import { aiGuard } from "@/server/ai/guard";
import { getSql } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbStatus = "connected";
  try {
    const sql = getSql();
    await sql`SELECT 1`;
  } catch {
    dbStatus = "disconnected";
  }

  const aiEnabled = process.env.AI_ENABLED !== "false";
  const aiConf = aiConfigured();
  const breakerState = aiGuard.state().breaker;

  return jsonOk({
    status: dbStatus === "connected" ? "ok" : "degraded",
    db: dbStatus,
    ai: {
      enabled: aiEnabled,
      configured: aiConf,
      breaker: breakerState,
    },
    version: "0.1.0",
  });
}
