import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { glossaryTerms, guidelineSections } from "@/server/db/schema";
import type { NormalizedDocument } from "@/server/ingest/types";
import { filterFindings } from "../validate";
import { matchGlossary, type SectionRef } from "./glossary-match";
import { runStyleRules } from "./style-rules";
import type { Finding } from "../types";

export async function runFastTier(
  brandId: string,
  doc: NormalizedDocument,
): Promise<{ findings: Finding[]; log: string[] }> {
  const db = getDb();
  const [terms, sections] = await Promise.all([
    db.select().from(glossaryTerms).where(eq(glossaryTerms.brandId, brandId)),
    db.select().from(guidelineSections).where(eq(guidelineSections.brandId, brandId)),
  ]);
  const sectionRefs: SectionRef[] = sections.map((s) => ({
    code: s.code,
    body: s.body,
  }));
  const skipped: string[] = [];
  const raw = [
    ...matchGlossary(doc.blocks, terms, sectionRefs),
    ...runStyleRules(doc.blocks, sectionRefs, skipped),
  ];
  const codes = new Set(sections.map((s) => s.code));
  for (const t of terms) codes.add(t.code);
  const filtered = filterFindings(raw, {
    codes,
    blockText: new Map(doc.blocks.map((b) => [b.id, b.text])),
  });
  return { findings: filtered.kept, log: [...skipped, ...filtered.log] };
}
