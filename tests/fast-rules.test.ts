import { describe, expect, it } from "vitest";
import { matchGlossary } from "@/server/review/fast/glossary-match";
import { runStyleRules } from "@/server/review/fast/style-rules";

const sections = [
  { code: "GL-2.1", body: 'Pricing words: say "affordable", never "cheap".' },
  { code: "GL-2.3", body: 'We say "customers", not "clients".' },
  { code: "GL-2.4", body: 'The product is "tea pouches", not "tea bags".' },
  { code: "GL-3.1", body: 'Calm and warm. No capitals for emphasis, one "!" at most.' },
];

const terms = [
  {
    code: "GL-2.1",
    badTerm: "cheap",
    preferredTerm: "affordable",
    matchMode: "word",
    caseSensitive: false,
    note: null,
  },
  {
    code: "GL-2.3",
    badTerm: "clients",
    preferredTerm: "customers",
    matchMode: "word",
    caseSensitive: false,
    note: null,
  },
  {
    code: "GL-2.4",
    badTerm: "tea bags",
    preferredTerm: "tea pouches",
    matchMode: "phrase",
    caseSensitive: false,
    note: null,
  },
];

describe("fast rules", () => {
  it("matches glossary terms with source citations and suggestions", () => {
    const findings = matchGlossary(
      [{ id: "b1", kind: "paragraph", text: "Cheap tea bags for clients." }],
      terms,
      sections,
    );
    expect(findings.map((f) => f.source.code).sort()).toEqual([
      "GL-2.1",
      "GL-2.3",
      "GL-2.4",
    ]);
    expect(findings.find((f) => f.source.code === "GL-2.1")?.suggestion).toBe(
      "Affordable",
    );
    expect(findings.find((f) => f.source.code === "GL-2.4")?.suggestion).toBe(
      "tea pouches",
    );
  });

  it("fuzzy-matches terms longer than 6 characters and ignores shorter near-misses", () => {
    const findings = matchGlossary(
      [{ id: "b1", kind: "paragraph", text: "Our clents like a cheep cup." }],
      terms,
      sections,
    );
    const codes = findings.map((f) => f.source.code);
    expect(codes).toEqual(["GL-2.3"]);
    expect(findings[0]?.confidence).toBe(0.8);
    expect(findings[0]?.matchedText).toBe("clents");
  });

  it("flags capital emphasis and repeated exclamation marks", () => {
    const findings = runStyleRules(
      [{ id: "b1", kind: "paragraph", text: "Our BEST tea!! Try it." }],
      sections,
      [],
    );
    expect(findings.some((f) => f.matchedText === "BEST")).toBe(true);
    expect(findings.some((f) => f.matchedText === "!!")).toBe(true);
    expect(findings.every((f) => f.source.code === "GL-3.1")).toBe(true);
  });

  it("reports a skipped style rule when the voice section is missing", () => {
    const skipped: string[] = [];
    const findings = runStyleRules(
      [{ id: "b1", kind: "paragraph", text: "Our BEST tea!!" }],
      sections.filter((s) => s.code !== "GL-3.1"),
      skipped,
    );
    expect(findings).toHaveLength(0);
    expect(skipped[0]).toContain("GL-3.1");
  });
});
