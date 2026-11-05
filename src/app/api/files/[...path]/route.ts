import fs from "node:fs/promises";
import { jsonError } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/api";
import { resolveStoredPath } from "@/server/storage";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/files/[...path]">,
) {
  const { user, error } = await requireApiUser();
  if (!user) return error;
  const { path: parts } = await ctx.params;
  try {
    const relative = parts.join("/");
    const full = resolveStoredPath(relative);
    const data = await fs.readFile(full);
    return new Response(data, {
      headers: { "content-type": "application/octet-stream" },
    });
  } catch {
    return jsonError("not_found", "File not found", 404);
  }
}
