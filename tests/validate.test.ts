import { describe, expect, it } from "vitest";
import { buildAllowedSourceCodes } from "@/server/review/deep/sources";
import { pickSafeRewrite } from "@/server/review/deep/rewrite";
import type { Finding } from "@/server/review/types";
import { filterFindings } from "@/server/review/validate";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: crypto.randomUUID(),
    tier: "deep",
    kind: "Claim check",
    severity: "error",
    confidence: 0.9,
    blockId: "b1",
    start: 0,
    end: 8,
    matchedText: "Our tea.",
    message: "Check this.",
    source: {
      type: "claim",
      code: "AC-1",
      snapshot: "Sourced from 14 partner estates.",
    },
    suggestion: null,
    state: "open",
    ...overrides,
  };
}

describe("source-or-silence filtering", () => {
  const blockText = new Map([["b1", "Our tea. Packaging is recyclable."]]);

  it("keeps claim findings when approved claim codes are allowed", () => {
    const codes = buildAllowedSourceCodes({
      sections: [{ code: "GL-4.2" }],
      claims: [{ code: "AC-1" }, { code: "AC-2" }],
      verified: ["AC-2"],
    });
    const result = filterFindings([finding()], { codes, blockText });
    expect(result.kept).toHaveLength(1);
    expect(result.discarded).toBe(0);
  });

  it("drops findings that cite a source outside the allowed set", () => {
    const codes = buildAllowedSourceCodes({
      sections: [{ code: "GL-4.2" }],
      claims: [],
    });
    const result = filterFindings([finding()], { codes, blockText });
    expect(result.kept).toHaveLength(0);
    expect(result.discarded).toBe(1);
    expect(result.log[0]).toContain("source");
  });

  it("drops findings whose quoted text is not in the block", () => {
    const codes = new Set(["AC-1"]);
    const result = filterFindings(
      [finding({ matchedText: "Not present" })],
      { codes, blockText },
    );
    expect(result.kept).toHaveLength(0);
    expect(result.discarded).toBe(1);
  });

  it("forces low-confidence findings to questions", () => {
    const codes = new Set(["AC-1"]);
    const result = filterFindings(
      [finding({ confidence: 0.59 })],
      { codes, blockText },
    );
    expect(result.kept[0]?.severity).toBe("question");
  });

  it("removes empty or oversized suggestions", () => {
    const codes = new Set(["AC-1"]);
    const empty = filterFindings(
      [finding({ suggestion: "   " })],
      { codes, blockText },
    );
    expect(empty.kept[0]?.suggestion).toBeNull();

    const oversized = filterFindings(
      [finding({ suggestion: "x".repeat(100) })],
      { codes, blockText },
    );
    expect(oversized.kept[0]?.suggestion).toBeNull();
  });
});

describe("claim rewrite safety", () => {
  it("keeps rewrites that are inside an approved claim", () => {
    expect(
      pickSafeRewrite("14 partner estates", [
        { text: "Sourced from 14 partner estates in Assam and Darjeeling." },
      ]),
    ).toBe("14 partner estates");
  });

  it("drops rewrites that introduce unapproved language", () => {
    expect(
      pickSafeRewrite("over 50 estates", [
        { text: "Sourced from 14 partner estates in Assam and Darjeeling." },
      ]),
    ).toBeNull();
    expect(pickSafeRewrite(null, [])).toBeNull();
  });
});
