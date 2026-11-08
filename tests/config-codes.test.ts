import { describe, expect, it } from "vitest";
import { CLAIMS_POLICY_CODE, STYLE_VOICE_CODE } from "@/lib/config";
import { runStyleRules } from "@/server/review/fast/style-rules";

describe("configurable guideline codes", () => {
  it("defaults CLAIMS_POLICY_CODE and STYLE_VOICE_CODE correctly", () => {
    expect(CLAIMS_POLICY_CODE).toBe("GL-4.2");
    expect(STYLE_VOICE_CODE).toBe("GL-3.1");
  });

  it("skips style rules gracefully when the configured voice code is missing", () => {
    const skipped: string[] = [];
    const findings = runStyleRules(
      [{ id: "b1", kind: "paragraph", text: "OUR TEA!!" }],
      [{ code: "GL-OTHER", body: "Other rule" }],
      skipped,
    );

    expect(findings).toHaveLength(0);
    expect(skipped[0]).toContain(STYLE_VOICE_CODE);
  });
});
