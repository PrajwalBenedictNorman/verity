import { eq } from "drizzle-orm";
import brandSeed from "@/server/db/seed-data/brand.json";
import { auth } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import {
  approvedClaims,
  brandColours,
  brands,
  glossaryTerms,
  guidelineSections,
} from "@/server/db/schema";
import { ClaimsTable } from "@/components/brand/ClaimsTable";
import { ColoursTable } from "@/components/brand/ColoursTable";
import { GlossaryTable } from "@/components/brand/GlossaryTable";
import { SectionsList } from "@/components/brand/SectionsList";

export default async function BrandPage() {
  const session = await auth();
  const canEdit = session?.user
    ? can({
        role: session.user.role,
        permission: "brand.edit",
        userId: session.user.id,
      })
    : false;

  const db = getDb();
  const [brandRow] = await db.select().from(brands).limit(1);
  const brandId = brandRow?.id ?? brandSeed.id;
  const brandName = brandRow?.name ?? brandSeed.name;
  const [sections, glossary, claims, colours] = await Promise.all([
    db.select().from(guidelineSections).where(eq(guidelineSections.brandId, brandId)),
    db.select().from(glossaryTerms).where(eq(glossaryTerms.brandId, brandId)),
    db.select().from(approvedClaims).where(eq(approvedClaims.brandId, brandId)),
    db.select().from(brandColours).where(eq(brandColours.brandId, brandId)),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Brand rules · {brandName}</h1>
        <p className="mt-1 text-sm text-muted">
          {canEdit
            ? "Admins can add and delete rules. Existing rules are edited in the seed file."
            : "Read-only. Sign in as an admin to add or delete rules."}
        </p>
      </div>
      <SectionsList rows={sections} canEdit={canEdit} />
      <GlossaryTable rows={glossary} canEdit={canEdit} />
      <ClaimsTable rows={claims} canEdit={canEdit} />
      <ColoursTable rows={colours} canEdit={canEdit} />
    </div>
  );
}
