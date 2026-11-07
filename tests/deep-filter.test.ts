import { describe, expect, it } from "vitest";
import { buildAllowedSourceCodes } from "@/server/review/deep/sources";
import { pickSafeRewrite } from "@/server/review/deep/rewrite";
import { filterFindings } from "@/server/review/validate";
import type { Finding } from "@/server/review/types";

describe("deep review source-or-silence and rewrite validation", () => {
  it("builds allowed source codes including sections, claims, and verified claims", () => {
    const codes = buildAllowedSourceCodes({
      sections: [{ code: "GL-1.1" }, { code: "GL-4.2" }],
      claims: [{ code: "AC-1" }, { code: "AC-2" }],
      verified: ["AC-3"],
    });

    expect(codes.has("GL-1.1")).toBe(true);
    expect(codes.has("GL-4.2")).toBe(true);
    expect(codes.has("AC-1")).toBe(true);
    expect(codes.has("AC-2")).toBe(true);
    expect(codes.has("AC-3")).toBe(true);
    expect(codes.has("FORGED-99")).toBe(false);
  });

  it("filters findings based on allowed claim codes and discards forged codes", () => {
    const blockText = new Map([
      ["b1", "Our tea is sourced from 50 partner estates."],
    ]);

    const claimFinding: Finding = {
      id: "f1",
      blockId: "b1",
      start: 0,
      end: 42,
      matchedText: "Our tea is sourced from 50 partner estates.",
      kind: "Claim check",
      severity: "warn",
      source: {
        type: "claim",
        code: "AC-1",
        snapshot: "14 partner estates across Assam and Darjeeling",
      },
      suggestion: null,
      message: "Contradicts approved claim AC-1",
      confidence: 0.9,
      tier: "deep",
      state: "open",
    };

    const forgedFinding: Finding = {
      ...claimFinding,
      id: "f2",
      source: {
        type: "claim",
        code: "NON_EXISTENT_CODE",
        snapshot: "Some fake snapshot",
      },
    };

    // When AC-1 is in allowed codes
    const allowed = new Set(["AC-1", "GL-4.2"]);
    const resAllowed = filterFindings([claimFinding, forgedFinding], {
      codes: allowed,
      blockText,
    });
    expect(resAllowed.kept.map((f) => f.id)).toEqual(["f1"]);
    expect(resAllowed.discarded).toBe(1);

    // When AC-1 is NOT in allowed codes (the regression case)
    const sectionsOnly = new Set(["GL-4.2"]);
    const resSectionsOnly = filterFindings([claimFinding], {
      codes: sectionsOnly,
      blockText,
    });
    expect(resSectionsOnly.kept).toHaveLength(0);
    expect(resSectionsOnly.discarded).toBe(1);
  });

  it("sanitizes suggested rewrites using approved claim text", () => {
    const approvedClaims = [
      { text: "14 partner estates across Assam and Darjeeling" },
      { text: "Packaging is 100% recyclable" },
    ];

    // Substring match should be kept
    expect(
      pickSafeRewrite("14 partner estates", approvedClaims),
    ).toBe("14 partner estates");

    // Case-insensitive substring match should be kept
    expect(
      pickSafeRewrite("100% RECYCLABLE", approvedClaims),
    ).toBe("100% RECYCLABLE");

    // Hallucinated rewrite not in approved claims should be rejected
    expect(
      pickSafeRewrite("Sourced from exactly 12 small farms", approvedClaims),
    ).toBeNull();

    // Empty or null rewrite returns null
    expect(pickSafeRewrite(null, approvedClaims)).toBeNull();
    expect(pickSafeRewrite("   ", approvedClaims)).toBeNull();
  });
});
