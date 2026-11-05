import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb, getSql } from "./client";
import {
  approvedClaims,
  brandColours,
  brands,
  glossaryTerms,
  guidelineSections,
  submissions,
  users,
} from "./schema";
import brand from "./seed-data/brand.json";
import type { NormalizedDocument } from "@/server/ingest/types";

const USER_IDS = {
  creator: "22222222-2222-4222-8222-222222222221",
  reviewer: "22222222-2222-4222-8222-222222222222",
  admin: "22222222-2222-4222-8222-222222222223",
};

const DEMO_SUBMISSION_ID = "33333333-3333-4333-8333-333333333333";

const DEMO_TEXT = `Kettle & Co. Monsoon Blend

Our BEST tea bags in India!! Loved by tea drinkers everywhere, and cheap too.

Every pouch is sourced from over 50 estates across Assam and Darjeeling, and it is 100% organic. Packaging is 100% recyclable. Ask any of our clients.`;

function demoNormalized(): NormalizedDocument {
  const heading = "Kettle & Co. Monsoon Blend";
  const p1 =
    "Our BEST tea bags in India!! Loved by tea drinkers everywhere, and cheap too.";
  const p2 =
    "Every pouch is sourced from over 50 estates across Assam and Darjeeling, and it is 100% organic. Packaging is 100% recyclable. Ask any of our clients.";
  const blocks = [
    { id: "b1", kind: "heading" as const, text: heading, level: 1 },
    { id: "b2", kind: "paragraph" as const, text: p1 },
    { id: "b3", kind: "paragraph" as const, text: p2 },
  ];
  return {
    version: 1,
    sourceKind: "text",
    title: heading,
    blocks,
    images: [],
    stats: {
      chars: blocks.reduce((n, b) => n + b.text.length, 0),
      blocks: blocks.length,
      images: 0,
    },
  };
}

async function seed() {
  const password = process.env.SEED_USER_PASSWORD;
  if (!password) {
    throw new Error("SEED_USER_PASSWORD is not set");
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const db = getDb();

  await db
    .insert(brands)
    .values({ id: brand.id, name: brand.name })
    .onConflictDoUpdate({
      target: brands.id,
      set: { name: brand.name },
    });

  const seedUsers = [
    {
      id: USER_IDS.creator,
      email: "creator@kettle.test",
      name: "Creator",
      role: "creator" as const,
    },
    {
      id: USER_IDS.reviewer,
      email: "reviewer@kettle.test",
      name: "Reviewer",
      role: "reviewer" as const,
    },
    {
      id: USER_IDS.admin,
      email: "admin@kettle.test",
      name: "Admin",
      role: "admin" as const,
    },
  ];

  for (const u of seedUsers) {
    await db
      .insert(users)
      .values({ ...u, passwordHash })
      .onConflictDoUpdate({
        target: users.email,
        set: { name: u.name, role: u.role, passwordHash },
      });
  }

  for (const section of brand.sections) {
    const existing = await db
      .select()
      .from(guidelineSections)
      .where(eq(guidelineSections.code, section.code));
    const row = existing.find((s) => s.brandId === brand.id);
    if (row) {
      await db
        .update(guidelineSections)
        .set({
          category: section.category,
          title: section.title,
          body: section.body,
        })
        .where(eq(guidelineSections.id, row.id));
    } else {
      await db.insert(guidelineSections).values({
        brandId: brand.id,
        code: section.code,
        category: section.category,
        title: section.title,
        body: section.body,
      });
    }
  }

  const existingGlossary = await db
    .select()
    .from(glossaryTerms)
    .where(eq(glossaryTerms.brandId, brand.id));
  if (existingGlossary.length === 0) {
    await db.insert(glossaryTerms).values(
      brand.glossary.map((g) => ({
        brandId: brand.id,
        code: g.code,
        badTerm: g.badTerm,
        preferredTerm: g.preferredTerm,
        matchMode: g.matchMode,
        note: g.note,
      })),
    );
  }

  for (const claim of brand.claims) {
    const existing = await db
      .select()
      .from(approvedClaims)
      .where(eq(approvedClaims.code, claim.code));
    const row = existing.find((c) => c.brandId === brand.id);
    if (row) {
      await db
        .update(approvedClaims)
        .set({ text: claim.text, tags: claim.tags })
        .where(eq(approvedClaims.id, row.id));
    } else {
      await db.insert(approvedClaims).values({
        brandId: brand.id,
        code: claim.code,
        text: claim.text,
        tags: claim.tags,
      });
    }
  }

  const existingColours = await db
    .select()
    .from(brandColours)
    .where(eq(brandColours.brandId, brand.id));
  if (existingColours.length === 0) {
    await db.insert(brandColours).values(
      brand.colours.map((c) => ({
        brandId: brand.id,
        name: c.name,
        hex: c.hex,
        maxDeviation: c.maxDeviation,
      })),
    );
  }

  const [existingDemo] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, DEMO_SUBMISSION_ID));
  if (!existingDemo) {
    await db.insert(submissions).values({
      id: DEMO_SUBMISSION_ID,
      brandId: brand.id,
      creatorId: USER_IDS.creator,
      title: "Kettle & Co. Monsoon Blend",
      status: "draft",
      sourceKind: "text",
      normalized: demoNormalized(),
    });
  }

  console.log("Seed complete.");
  console.log("Users: creator@kettle.test, reviewer@kettle.test, admin@kettle.test");
  console.log(`Demo text chars: ${DEMO_TEXT.length}`);
  await getSql().end({ timeout: 5 });
}

seed().catch(async (err) => {
  console.error(err);
  try {
    await getSql().end({ timeout: 1 });
  } catch {
    // ignore
  }
  process.exit(1);
});
