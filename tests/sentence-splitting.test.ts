import { describe, expect, it } from "vitest";
import { extractClaimCandidates } from "@/server/review/deep/candidates";
import type { Block } from "@/server/ingest/types";

describe("sentence splitting in candidate extraction", () => {
  it("does not split numbers with decimals or abbreviations into fragments", () => {
    const testCases: { text: string; expectedSentence: string }[] = [
      {
        text: "We grew 2.5 million units.",
        expectedSentence: "We grew 2.5 million units.",
      },
      {
        text: "Compare e.g. Assam with Darjeeling for the best flavor.",
        expectedSentence: "Compare e.g. Assam with Darjeeling for the best flavor.",
      },
      {
        text: "Made in the U.S. since 1990.",
        expectedSentence: "Made in the U.S. since 1990.",
      },
      {
        text: "Dr. Rao certified the blend as 100% organic.",
        expectedSentence: "Dr. Rao certified the blend as 100% organic.",
      },
      {
        text: "Version 3.2 ships in Q2 with guaranteed freshness.",
        expectedSentence: "Version 3.2 ships in Q2 with guaranteed freshness.",
      },
    ];

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i]!;
      const blocks: Block[] = [{ id: `b${i + 1}`, kind: "paragraph", text: tc.text }];
      const candidates = extractClaimCandidates(blocks);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.sentence).toBe(tc.expectedSentence);
      expect(candidates[0]!.start).toBe(0);
      expect(candidates[0]!.end).toBe(tc.text.length);
      // Key invariant: slice(start, end) must equal the extracted sentence
      expect(tc.text.slice(candidates[0]!.start, candidates[0]!.end)).toBe(
        candidates[0]!.sentence,
      );
    }
  });

  it("handles the demo text with multiple sentences and preserves offsets", () => {
    const text =
      "Sourced from over 50 partner estates across Assam and Darjeeling. Every pouch is 100% organic. Enjoy daily.";
    const blocks: Block[] = [{ id: "b1", kind: "paragraph", text }];
    const candidates = extractClaimCandidates(blocks);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.sentence).toBe(
      "Sourced from over 50 partner estates across Assam and Darjeeling.",
    );
    expect(text.slice(candidates[0]!.start, candidates[0]!.end)).toBe(
      candidates[0]!.sentence,
    );

    expect(candidates[1]!.sentence).toBe("Every pouch is 100% organic.");
    expect(text.slice(candidates[1]!.start, candidates[1]!.end)).toBe(
      candidates[1]!.sentence,
    );
  });
});
