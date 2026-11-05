CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."deep_status" AS ENUM('pending', 'running', 'done', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('creator', 'reviewer', 'admin');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('error', 'warn', 'question');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('guideline', 'claim', 'glossary');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('draft', 'in_review', 'changes_requested', 'approved');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('fast', 'deep');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approved_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"code" text NOT NULL,
	"text" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"embedding" vector(1536),
	CONSTRAINT "approved_claims_brand_code" UNIQUE("brand_id","code")
);
--> statement-breakpoint
CREATE TABLE "brand_colours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hex" text NOT NULL,
	"max_deviation" integer DEFAULT 10 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"tier" "tier" NOT NULL,
	"kind" text NOT NULL,
	"severity" "severity" NOT NULL,
	"confidence" real NOT NULL,
	"block_id" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"matched_text" text NOT NULL,
	"message" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_code" text NOT NULL,
	"source_snapshot" text NOT NULL,
	"suggestion" text,
	"state" text DEFAULT 'open' NOT NULL,
	"dismiss_reason" text
);
--> statement-breakpoint
CREATE TABLE "glossary_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"code" text NOT NULL,
	"bad_term" text NOT NULL,
	"preferred_term" text NOT NULL,
	"match_mode" text DEFAULT 'word' NOT NULL,
	"case_sensitive" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "guideline_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"code" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"embedding" vector(1536),
	CONSTRAINT "guideline_sections_brand_code" UNIQUE("brand_id","code")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"fast_ms" integer,
	"deep_ms" integer,
	"deep_status" "deep_status" DEFAULT 'pending' NOT NULL,
	"score" integer,
	"discarded_count" integer DEFAULT 0 NOT NULL,
	"verified_claim_codes" text[] DEFAULT '{}' NOT NULL,
	"disclosure" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "status" DEFAULT 'draft' NOT NULL,
	"source_kind" text NOT NULL,
	"original_file_path" text,
	"normalized" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role" NOT NULL,
	"password_hash" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approved_claims" ADD CONSTRAINT "approved_claims_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_colours" ADD CONSTRAINT "brand_colours_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guideline_sections" ADD CONSTRAINT "guideline_sections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approved_claims_embedding_idx" ON "approved_claims" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "findings_review_id_idx" ON "findings" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "guideline_sections_embedding_idx" ON "guideline_sections" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "submissions_brand_status_idx" ON "submissions" USING btree ("brand_id","status");