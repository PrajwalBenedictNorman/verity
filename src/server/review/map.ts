import type { findings } from "@/server/db/schema";
import type { Finding } from "./types";

type FindingRow = typeof findings.$inferSelect;

export function rowToFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    tier: row.tier,
    kind: row.kind as Finding["kind"],
    severity: row.severity,
    confidence: row.confidence,
    blockId: row.blockId,
    start: row.startOffset,
    end: row.endOffset,
    matchedText: row.matchedText,
    message: row.message,
    source: {
      type: row.sourceType,
      code: row.sourceCode,
      snapshot: row.sourceSnapshot,
    },
    suggestion: row.suggestion,
    state: row.state as Finding["state"],
    dismissReason: row.dismissReason ?? undefined,
  };
}

export function findingToInsert(reviewId: string, finding: Finding) {
  return {
    id: finding.id,
    reviewId,
    tier: finding.tier,
    kind: finding.kind,
    severity: finding.severity,
    confidence: finding.confidence,
    blockId: finding.blockId,
    startOffset: finding.start,
    endOffset: finding.end,
    matchedText: finding.matchedText,
    message: finding.message,
    sourceType: finding.source.type,
    sourceCode: finding.source.code,
    sourceSnapshot: finding.source.snapshot,
    suggestion: finding.suggestion,
    state: finding.state,
    dismissReason: finding.dismissReason ?? null,
  };
}
