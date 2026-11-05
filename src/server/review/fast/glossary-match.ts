import type { Block } from "@/server/ingest/types";
import type { Finding } from "../types";
import { damerauLevenshtein } from "../damerau";

export type GlossaryTerm = {
  code: string;
  badTerm: string;
  preferredTerm: string;
  matchMode: string;
  caseSensitive: boolean;
  note: string | null;
};

export type SectionRef = {
  code: string;
  body: string;
};

function applyCase(preferred: string, matched: string) {
  if (matched === matched.toUpperCase()) return preferred.toUpperCase();
  if (matched === matched.toLowerCase()) return preferred.toLowerCase();
  if (matched[0] === matched[0]?.toUpperCase()) {
    return preferred
      .split(" ")
      .map((w, i) => {
        if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1);
        return w;
      })
      .join(" ");
  }
  return preferred;
}

function sourceFor(term: GlossaryTerm, sections: SectionRef[]) {
  const section = sections.find((s) => s.code === term.code);
  return {
    type: "guideline" as const,
    code: term.code,
    snapshot: section?.body ?? term.note ?? term.preferredTerm,
  };
}

function pushFinding(
  out: Finding[],
  args: {
    block: Block;
    start: number;
    end: number;
    term: GlossaryTerm;
    sections: SectionRef[];
    confidence: number;
  },
) {
  const matchedText = args.block.text.slice(args.start, args.end);
  out.push({
    id: crypto.randomUUID(),
    tier: "fast",
    kind: "Terminology",
    severity: "error",
    confidence: args.confidence,
    blockId: args.block.id,
    start: args.start,
    end: args.end,
    matchedText,
    message: `Use “${args.term.preferredTerm}” instead of “${matchedText}”.`,
    source: sourceFor(args.term, args.sections),
    suggestion: applyCase(args.term.preferredTerm, matchedText),
    state: "open",
  });
}

function matchPhrase(text: string, phrase: string, caseSensitive: boolean) {
  const flags = caseSensitive ? "g" : "gi";
  const escaped = phrase
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const re = new RegExp(escaped, flags);
  const hits: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    hits.push({ start: m.index, end: m.index + m[0].length });
  }
  return hits;
}

function matchWord(text: string, term: string, caseSensitive: boolean) {
  const flags = caseSensitive ? "gu" : "giu";
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, flags);
  const hits: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    hits.push({ start: m.index, end: m.index + m[0].length });
  }
  return hits;
}

export function matchGlossary(
  blocks: Block[],
  terms: GlossaryTerm[],
  sections: SectionRef[],
): Finding[] {
  const findings: Finding[] = [];
  for (const block of blocks) {
    for (const term of terms) {
      const hits =
        term.matchMode === "phrase"
          ? matchPhrase(block.text, term.badTerm, term.caseSensitive)
          : matchWord(block.text, term.badTerm, term.caseSensitive);
      const occupied = new Set<number>();
      for (const hit of hits) {
        for (let i = hit.start; i < hit.end; i++) occupied.add(i);
        pushFinding(findings, {
          block,
          start: hit.start,
          end: hit.end,
          term,
          sections,
          confidence: 1,
        });
      }
      if (term.matchMode !== "word") continue;
      if (term.badTerm.length <= 6) continue;
      const compare = (s: string) => (term.caseSensitive ? s : s.toLowerCase());
      const target = compare(term.badTerm);
      const wordRe = /[\p{L}\p{N}_]+/gu;
      let wm: RegExpExecArray | null;
      while ((wm = wordRe.exec(block.text))) {
        const word = wm[0];
        const start = wm.index;
        const end = start + word.length;
        if ([...Array(end - start).keys()].some((i) => occupied.has(start + i))) {
          continue;
        }
        if (compare(word) === target) continue;
        if (damerauLevenshtein(compare(word), target) <= 1) {
          pushFinding(findings, {
            block,
            start,
            end,
            term,
            sections,
            confidence: 0.8,
          });
        }
      }
    }
  }
  return findings;
}
