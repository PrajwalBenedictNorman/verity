import type { Block } from "@/server/ingest/types";

export type ClaimCandidate = {
  blockId: string;
  start: number;
  end: number;
  sentence: string;
};

const CLAIM_RE =
  /(\d|%|best|#1|leading|fastest|only|guaranteed|organic|certified|recyclable|sustainable|free from|sourced|made in|grown in|everywhere|everyone|always|never)/i;

const ABBR_RE = /\b(?:e\.g|i\.e|u\.s|u\.k|dr|mr|mrs|ms|vs|etc)\./gi;
const DECIMAL_RE = /(?<=\d)\.(?=\d)/g;

function splitSentences(text: string): { start: number; end: number; sentence: string }[] {
  // Protect periods in abbreviations and decimals using a 1:1 character mask
  const masked = text
    .replace(ABBR_RE, (m) => m.replace(/\./g, "\uE000"))
    .replace(DECIMAL_RE, "\uE000");

  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const out: { start: number; end: number; sentence: string }[] = [];

  for (const { segment, index } of segmenter.segment(masked)) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    // Find the slice in the original text matching the segment's non-whitespace boundaries
    const leadingWs = segment.length - segment.trimStart().length;
    const trailingWs = segment.length - segment.trimEnd().length;
    const start = index + leadingWs;
    const end = index + segment.length - trailingWs;
    const sentence = text.slice(start, end);
    out.push({ start, end, sentence });
  }
  return out;
}

export function extractClaimCandidates(blocks: Block[]): ClaimCandidate[] {
  const found: ClaimCandidate[] = [];
  for (const block of blocks) {
    for (const part of splitSentences(block.text)) {
      if (CLAIM_RE.test(part.sentence)) {
        found.push({
          blockId: block.id,
          start: part.start,
          end: part.end,
          sentence: part.sentence,
        });
      }
    }
  }
  return found;
}

export function isHardFactualClaim(sentence: string) {
  return /(\d|%|organic|certified|recyclable|sustainable|free from)/i.test(sentence);
}
