import { CONFIDENCE_QUESTION_THRESHOLD } from "@/lib/config";
import type { Finding } from "./types";

export type SourceIndex = {
  codes: Set<string>;
  blockText: Map<string, string>;
};

export type FilterResult = {
  kept: Finding[];
  discarded: number;
  log: string[];
};

function forceQuestion(finding: Finding): Finding {
  if (finding.confidence < CONFIDENCE_QUESTION_THRESHOLD && finding.severity !== "question") {
    return { ...finding, severity: "question" };
  }
  return finding;
}

export function filterFindings(
  findings: Finding[],
  sources: SourceIndex,
): FilterResult {
  const kept: Finding[] = [];
  let discarded = 0;
  for (const raw of findings) {
    const finding = forceQuestion(raw);
    if (!sources.codes.has(finding.source.code)) {
      discarded += 1;
      continue;
    }
    const text = sources.blockText.get(finding.blockId) ?? "";
    const span = text.slice(finding.start, finding.end);
    if (finding.start < 0 || finding.end > text.length || span !== finding.matchedText) {
      const idx = text.indexOf(finding.matchedText);
      if (idx === -1) {
        discarded += 1;
        continue;
      }
      finding.start = idx;
      finding.end = idx + finding.matchedText.length;
    }
    if (finding.suggestion) {
      const max = Math.max(1, finding.matchedText.length) * 3;
      if (finding.suggestion.trim().length === 0 || finding.suggestion.length >= max) {
        finding.suggestion = null;
      }
    }
    kept.push(finding);
  }
  const log: string[] = [];
  if (discarded > 0) {
    log.push(
      `${discarded} finding(s) dropped: cited a source that doesn't exist or text not found`,
    );
  }
  return { kept, discarded, log };
}
