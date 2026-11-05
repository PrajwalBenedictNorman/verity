import { eq } from "drizzle-orm";
import brandSeed from "@/server/db/seed-data/brand.json";
import { getDb } from "@/server/db/client";
import {
  approvedClaims,
  brandColours,
  glossaryTerms,
  guidelineSections,
} from "@/server/db/schema";

export default async function BrandPage() {
  const db = getDb();
  const brandId = brandSeed.id;
  const [sections, glossary, claims, colours] = await Promise.all([
    db.select().from(guidelineSections).where(eq(guidelineSections.brandId, brandId)),
    db.select().from(glossaryTerms).where(eq(glossaryTerms.brandId, brandId)),
    db.select().from(approvedClaims).where(eq(approvedClaims.brandId, brandId)),
    db.select().from(brandColours).where(eq(brandColours.brandId, brandId)),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Brand rules · {brandSeed.name}</h1>
      <section>
        <h2 className="mb-2 font-medium">Guideline sections</h2>
        <ul className="space-y-2 text-sm">
          {sections.map((s) => (
            <li key={s.id} className="rounded-lg border border-line bg-panel p-3">
              <p className="font-medium">
                {s.code} · {s.category}: {s.title}
              </p>
              <p className="mt-1 text-muted">{s.body}</p>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 font-medium">Glossary</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-1">Code</th>
              <th>Avoid</th>
              <th>Prefer</th>
            </tr>
          </thead>
          <tbody>
            {glossary.map((g) => (
              <tr key={g.id} className="border-t border-line">
                <td className="py-2">{g.code}</td>
                <td>{g.badTerm}</td>
                <td>{g.preferredTerm}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="mb-2 font-medium">Approved claims</h2>
        <ul className="space-y-2 text-sm">
          {claims.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-panel p-3">
              <span className="font-medium">{c.code}</span> {c.text}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 font-medium">Brand colours</h2>
        <ul className="flex gap-3 text-sm">
          {colours.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span
                className="inline-block h-5 w-5 rounded border border-line"
                style={{ background: c.hex }}
              />
              {c.name} {c.hex}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
