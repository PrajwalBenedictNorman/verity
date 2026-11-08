import { describe, expect, it } from "vitest";
import { applyFindingToDocument } from "@/server/review/apply";
import type { NormalizedDocument } from "@/server/ingest/types";
import brand from "@/server/db/seed-data/brand.json";
import { matchGlossary } from "@/server/review/fast/glossary-match";
import { runStyleRules } from "@/server/review/fast/style-rules";
import { extractClaimCandidates } from "@/server/review/deep/candidates";

describe("applyFindingToDocument (pure)", () => {
  const sampleDoc: NormalizedDocument = {
    version: 1,
    sourceKind: "text",
    title: "Sample Doc",
    blocks: [
      {
        id: "b1",
        kind: "paragraph",
        text: "We offer cheap tea bags for everyone.",
      },
      {
        id: "b2",
        kind: "paragraph",
        text: "Sourced from partner estates.",
      },
    ],
    images: [],
    stats: {
      chars: 66,
      blocks: 2,
      images: 0,
    },
  };

  it("applies suggestion once and updates doc and char count", () => {
    // "cheap" is at start: 9, end: 14
    const finding = {
      blockId: "b1",
      startOffset: 9,
      endOffset: 14,
      matchedText: "cheap",
      suggestion: "affordable",
    };

    const res = applyFindingToDocument(sampleDoc, finding);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.doc.blocks[0]!.text).toBe("We offer affordable tea bags for everyone.");
    // "cheap" (5 chars) -> "affordable" (10 chars), difference +5
    expect(res.doc.stats.chars).toBe(sampleDoc.stats.chars + 5);
  });

  it("does not mutate the original document object", () => {
    const originalText = sampleDoc.blocks[0]!.text;
    const finding = {
      blockId: "b1",
      startOffset: 9,
      endOffset: 14,
      matchedText: "cheap",
      suggestion: "affordable",
    };

    const res = applyFindingToDocument(sampleDoc, finding);
    expect(res.ok).toBe(true);
    expect(sampleDoc.blocks[0]!.text).toBe(originalText);
    expect(sampleDoc.stats.chars).toBe(66);
  });

  it("rejects with stale if text at offsets does not match matchedText", () => {
    // After applying "affordable", the text is now "We offer affordable tea bags for everyone."
    // A second attempt with original offsets (9, 14, "cheap") should be detected as stale:
    const mutatedDoc: NormalizedDocument = {
      ...sampleDoc,
      blocks: [
        {
          id: "b1",
          kind: "paragraph",
          text: "We offer affordable tea bags for everyone.",
        },
      ],
    };

    const finding = {
      blockId: "b1",
      startOffset: 9,
      endOffset: 14,
      matchedText: "cheap",
      suggestion: "affordable",
    };

    const res = applyFindingToDocument(mutatedDoc, finding);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("stale");
    expect(res.message).toContain("changed");
  });

  it("rejects with stale if offsets are wrong or out of bounds", () => {
    const finding = {
      blockId: "b1",
      startOffset: 0,
      endOffset: 10,
      matchedText: "cheap",
      suggestion: "affordable",
    };

    const res = applyFindingToDocument(sampleDoc, finding);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("stale");
  });

  it("rejects with block_missing if blockId does not exist in document", () => {
    const finding = {
      blockId: "non-existent-block",
      startOffset: 0,
      endOffset: 5,
      matchedText: "cheap",
      suggestion: "affordable",
    };

    const res = applyFindingToDocument(sampleDoc, finding);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("block_missing");
  });

  it("rejects with no_suggestion if suggestion is null, undefined, or empty", () => {
    const finding = {
      blockId: "b1",
      startOffset: 9,
      endOffset: 14,
      matchedText: "cheap",
      suggestion: "",
    };

    const res = applyFindingToDocument(sampleDoc, finding);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("no_suggestion");

    const nullFinding = {
      blockId: "b1",
      startOffset: 9,
      endOffset: 14,
      matchedText: "cheap",
      suggestion: null,
    };

    const res2 = applyFindingToDocument(sampleDoc, nullFinding);
    expect(res2.ok).toBe(false);
    if (res2.ok) return;
    expect(res2.code).toBe("no_suggestion");
  });

  it("invariant check: all fast findings on seeded demo text satisfy block.text.slice === matchedText", () => {
    const heading = "Kettle & Co. Monsoon Blend";
    const p1 =
      "Our BEST tea bags in India!! Loved by tea drinkers everywhere, and cheap too.";
    const p2 =
      "Every pouch is sourced from over 50 estates across Assam and Darjeeling, and it is 100% organic. Packaging is 100% recyclable. Ask any of our clients.";
    const blocks = [
      { id: "b1", kind: "heading" as const, text: heading, level: 1 },
      { id: "b2", kind: "paragraph" as const, text: p1 },
      { id: "b3", kind: "paragraph" as const, text: p2 },
    ];

    const sectionRefs = brand.sections.map((s) => ({
      code: s.code,
      body: s.body,
    }));
    const glossaryTerms = brand.glossary.map((g) => ({
      ...g,
      caseSensitive: false,
    }));
    const skipped: string[] = [];
    const glossaryFindings = matchGlossary(blocks, glossaryTerms, sectionRefs);
    const styleFindings = runStyleRules(blocks, sectionRefs, skipped);
    const allFastFindings = [...glossaryFindings, ...styleFindings];

    expect(allFastFindings.length).toBeGreaterThan(0);
    const blockMap = new Map(blocks.map((b) => [b.id, b.text]));

    for (const f of allFastFindings) {
      const text = blockMap.get(f.blockId)!;
      expect(text.slice(f.start, f.end)).toBe(f.matchedText);
      // Also verify applyFindingToDocument works on any finding that has a suggestion
      if (f.suggestion) {
        const doc: NormalizedDocument = {
          version: 1,
          sourceKind: "text",
          title: heading,
          blocks: blocks.map((b) => ({ ...b })),
          images: [],
          stats: { chars: 100, blocks: blocks.length, images: 0 },
        };
        const res = applyFindingToDocument(doc, {
          blockId: f.blockId,
          startOffset: f.start,
          endOffset: f.end,
          matchedText: f.matchedText,
          suggestion: f.suggestion,
        });
        expect(res.ok).toBe(true);
      }
    }
  });

  it("invariant check: deep candidate sentences on seeded demo text satisfy block.text.slice === sentence", () => {
    const p2 =
      "Every pouch is sourced from over 50 estates across Assam and Darjeeling, and it is 100% organic. Packaging is 100% recyclable. Ask any of our clients.";
    const blocks = [{ id: "b3", kind: "paragraph" as const, text: p2 }];
    const candidates = extractClaimCandidates(blocks);

    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(p2.slice(c.start, c.end)).toBe(c.sentence);
    }
  });
});
