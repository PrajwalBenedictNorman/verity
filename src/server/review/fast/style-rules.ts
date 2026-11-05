import type { Block } from "@/server/ingest/types";
import type { Finding } from "../types";
import type { SectionRef } from "./glossary-match";

export const ACRONYM_ALLOWLIST = [
  "HTML",
  "PDF",
  "DOCX",
  "HTTP",
  "HTTPS",
  "API",
  "CEO",
  "USA",
  "UK",
];

function cite(code: string, sections: SectionRef[]) {
  return sections.find((s) => s.code === code) ?? null;
}

function titleCaseWord(word: string) {
  return word.charAt(0) + word.slice(1).toLowerCase();
}

export function runStyleRules(
  blocks: Block[],
  sections: SectionRef[],
  skipped: string[],
): Finding[] {
  const voice = cite("GL-3.1", sections);
  if (!voice) {
    skipped.push("Style rule skipped: GL-3.1 not found in brand guidelines.");
    return [];
  }
  const findings: Finding[] = [];
  const allow = new Set(ACRONYM_ALLOWLIST);

  for (const block of blocks) {
    const capsRe = /(?<![A-Z])[A-Z]{4,}(?![A-Z])/g;
    let m: RegExpExecArray | null;
    while ((m = capsRe.exec(block.text))) {
      const word = m[0];
      if (allow.has(word)) continue;
      findings.push({
        id: crypto.randomUUID(),
        tier: "fast",
        kind: "Voice",
        severity: "warn",
        confidence: 1,
        blockId: block.id,
        start: m.index,
        end: m.index + word.length,
        matchedText: word,
        message: "Avoid capitals for emphasis.",
        source: { type: "guideline", code: voice.code, snapshot: voice.body },
        suggestion: titleCaseWord(word),
        state: "open",
      });
    }

    const bangRe = /!{2,}/g;
    let consecutive = false;
    while ((m = bangRe.exec(block.text))) {
      consecutive = true;
      findings.push({
        id: crypto.randomUUID(),
        tier: "fast",
        kind: "Voice",
        severity: "warn",
        confidence: 1,
        blockId: block.id,
        start: m.index,
        end: m.index + m[0].length,
        matchedText: m[0],
        message: "Use one exclamation mark at most.",
        source: { type: "guideline", code: voice.code, snapshot: voice.body },
        suggestion: "!",
        state: "open",
      });
    }

    const bangs = [...block.text.matchAll(/!/g)];
    if (!consecutive && bangs.length > 1) {
      const first = bangs[0]!;
      const last = bangs[bangs.length - 1]!;
      findings.push({
        id: crypto.randomUUID(),
        tier: "fast",
        kind: "Voice",
        severity: "warn",
        confidence: 1,
        blockId: block.id,
        start: first.index,
        end: last.index + 1,
        matchedText: block.text.slice(first.index, last.index + 1),
        message: "This block uses more than one exclamation mark.",
        source: { type: "guideline", code: voice.code, snapshot: voice.body },
        suggestion: null,
        state: "open",
      });
    }
  }
  return findings;
}
