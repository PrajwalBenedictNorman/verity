import type { NormalizedDocument } from "@/server/ingest/types";

export type ApplyResult =
  | { ok: true; doc: NormalizedDocument }
  | { ok: false; code: "block_missing" | "no_suggestion" | "stale"; message: string };

export type FindingForApply = {
  blockId: string;
  startOffset?: number;
  endOffset?: number;
  start?: number;
  end?: number;
  matchedText: string;
  suggestion?: string | null;
};

/**
 * Pure function to apply a finding's suggestion to a normalized document.
 * Returns a new document without mutating the input document.
 */
export function applyFindingToDocument(
  doc: NormalizedDocument,
  finding: FindingForApply,
): ApplyResult {
  if (!finding.suggestion || finding.suggestion.trim().length === 0) {
    return {
      ok: false,
      code: "no_suggestion",
      message: "This finding has no suggestion to apply.",
    };
  }

  const block = doc.blocks.find((b) => b.id === finding.blockId);
  if (!block) {
    return {
      ok: false,
      code: "block_missing",
      message: "Block not found in document.",
    };
  }

  const start = finding.startOffset ?? finding.start;
  const end = finding.endOffset ?? finding.end;

  if (start === undefined || end === undefined || start < 0 || end > block.text.length) {
    return {
      ok: false,
      code: "stale",
      message: "The text changed since this review. Run the review again.",
    };
  }

  const slice = block.text.slice(start, end);
  if (slice !== finding.matchedText) {
    return {
      ok: false,
      code: "stale",
      message: "The text changed since this review. Run the review again.",
    };
  }

  const newDoc = structuredClone(doc);
  const targetBlock = newDoc.blocks.find((b) => b.id === finding.blockId)!;
  targetBlock.text =
    targetBlock.text.slice(0, start) +
    finding.suggestion +
    targetBlock.text.slice(end);

  newDoc.stats.chars = newDoc.blocks.reduce((sum, b) => sum + b.text.length, 0);

  return { ok: true, doc: newDoc };
}
