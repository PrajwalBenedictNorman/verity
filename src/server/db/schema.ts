import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { NormalizedDocument } from "../ingest/types";
import type { Disclosure } from "../review/types";

import { EMBEDDING_DIM } from "../../lib/config";
export { EMBEDDING_DIM };

export const roleEnum = pgEnum("role", ["creator", "reviewer", "admin"]);
export const statusEnum = pgEnum("status", [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
]);
export const severityEnum = pgEnum("severity", ["error", "warn", "question"]);
export const tierEnum = pgEnum("tier", ["fast", "deep"]);
export const sourceTypeEnum = pgEnum("source_type", [
  "guideline",
  "claim",
  "glossary",
]);
export const deepStatusEnum = pgEnum("deep_status", [
  "pending",
  "running",
  "done",
  "failed",
  "skipped",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull(),
  passwordHash: text("password_hash").notNull(),
});

export const brands = pgTable("brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const guidelineSections = pgTable(
  "guideline_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    code: text("code").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
  },
  (t) => [
    unique("guideline_sections_brand_code").on(t.brandId, t.code),
    index("guideline_sections_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const glossaryTerms = pgTable("glossary_terms", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id),
  code: text("code").notNull(),
  badTerm: text("bad_term").notNull(),
  preferredTerm: text("preferred_term").notNull(),
  matchMode: text("match_mode").notNull().default("word"),
  caseSensitive: boolean("case_sensitive").notNull().default(false),
  note: text("note"),
});

export const approvedClaims = pgTable(
  "approved_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    code: text("code").notNull(),
    text: text("text").notNull(),
    tags: text("tags").array().notNull().default([]),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIM }),
  },
  (t) => [
    unique("approved_claims_brand_code").on(t.brandId, t.code),
    index("approved_claims_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const brandColours = pgTable("brand_colours", {
  id: uuid("id").defaultRandom().primaryKey(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id),
  name: text("name").notNull(),
  hex: text("hex").notNull(),
  maxDeviation: integer("max_deviation").notNull().default(10),
});

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    status: statusEnum("status").notNull().default("draft"),
    sourceKind: text("source_kind").notNull(),
    originalFilePath: text("original_file_path"),
    normalized: jsonb("normalized").$type<NormalizedDocument>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("submissions_brand_status_idx").on(t.brandId, t.status)],
);

export const reviews = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  fastMs: integer("fast_ms"),
  deepMs: integer("deep_ms"),
  deepStatus: deepStatusEnum("deep_status").notNull().default("pending"),
  score: integer("score"),
  discardedCount: integer("discarded_count").notNull().default(0),
  verifiedClaimCodes: text("verified_claim_codes").array().notNull().default([]),
  disclosure: jsonb("disclosure").$type<Disclosure>().notNull(),
});

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id),
    tier: tierEnum("tier").notNull(),
    kind: text("kind").notNull(),
    severity: severityEnum("severity").notNull(),
    confidence: real("confidence").notNull(),
    blockId: text("block_id").notNull(),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    matchedText: text("matched_text").notNull(),
    message: text("message").notNull(),
    sourceType: sourceTypeEnum("source_type").notNull(),
    sourceCode: text("source_code").notNull(),
    sourceSnapshot: text("source_snapshot").notNull(),
    suggestion: text("suggestion"),
    state: text("state").notNull().default("open"),
    dismissReason: text("dismiss_reason"),
  },
  (t) => [index("findings_review_id_idx").on(t.reviewId)],
);

export const activityLog = pgTable("activity_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
