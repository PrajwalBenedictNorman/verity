import type { Block } from "@/server/ingest/types";

export type ClaimCandidate = {
  blockId: string;
  start: number;
  end: number;
  sentence: string;
};

const CLAIM_RE =
  /(\d|%|best|#1|leading|fastest|only|guaranteed|organic|certified|recyclable|sustainable|free from|sourced|made in|grown in|everywhere|everyone|always|never)/i;

function splitSentences(text: string): { start: number; end: number; sentence: string }[] {
  const out: { start: number; end: number; sentence: string }[] = [];
  const re = /[^.!?]+[.!?]+|[^.!?]+$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const sentence = m[0].trim();
    if (!sentence) continue;
    const start = text.indexOf(sentence, m.index);
    out.push({ start, end: start + sentence.length, sentence });
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
