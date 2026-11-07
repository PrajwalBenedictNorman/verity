import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import * as dbClientModule from "@/server/db/client";

describe("Health API endpoint", () => {
  it("returns cached health state without exposing secrets", async () => {
    vi.spyOn(dbClientModule, "getSql").mockReturnValue(
      (() => Promise.resolve([{ "1": 1 }])) as unknown as ReturnType<
        typeof dbClientModule.getSql
      >,
    );

    const res = await GET();
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      ok: boolean;
      data: {
        status: string;
        db: string;
        ai: { enabled: boolean; configured: boolean; breaker: string };
        version: string;
      };
    };

    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("ok");
    expect(json.data.db).toBe("connected");
    expect(json.data.ai).toBeDefined();
    expect(json.data.ai.breaker).toBe("closed");
    expect(json.data.version).toBe("0.1.0");

    // Ensure no secrets exist in payload
    const str = JSON.stringify(json);
    expect(str).not.toContain("password");
    expect(str).not.toContain("secret");
    expect(str).not.toContain("Bearer");
  });
});
