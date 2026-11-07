import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { DEFAULT_BRAND_ID } from "@/lib/brand";
import { aiConfigured } from "@/server/ai/adapter";
import { getDb, getSql } from "@/server/db/client";
import {
  activityLog,
  findings,
  reviews,
  submissions,
  users,
} from "@/server/db/schema";
import { kindFromFilename, normalize } from "@/server/ingest/normalize";
import type { Finding } from "@/server/review/types";
import { rowToFinding } from "@/server/review/map";
import {
  latestReview,
  startReview,
} from "@/server/review/orchestrator";

type Expected = {
  fastMustInclude?: string[];
  fastMustExclude?: string[];
  fastMin?: number;
  fastMax?: number;
  deepMustInclude?: string[];
  deepMustExclude?: string[];
};

type Case = {
  file: string;
  title: string;
  expected: Expected;
};

type CaseResult = {
  file: string;
  pass: boolean;
  fastCount: number;
  fastCodes: string[];
  deepStatus: string;
  deepCodes: string[];
  score: number | null;
  details: string[];
};

const TESTSET_DIR = path.resolve(
  "src/server/db/seed-data/testset",
);

function codesOf(items: Pick<Finding, "source">[]) {
  return [...new Set(items.map((item) => item.source.code))];
}

function evaluateFast(expected: Expected, fast: Finding[]) {
  const details: string[] = [];
  const codes = codesOf(fast);
  const include = expected.fastMustInclude ?? [];
  const exclude = expected.fastMustExclude ?? [];

  for (const code of include) {
    if (!codes.includes(code)) details.push(`missing fast code ${code}`);
  }
  for (const code of exclude) {
    if (codes.includes(code)) details.push(`unexpected fast code ${code}`);
  }
  if (expected.fastMin !== undefined && fast.length < expected.fastMin) {
    details.push(`only ${fast.length} fast findings, expected at least ${expected.fastMin}`);
  }
  if (expected.fastMax !== undefined && fast.length > expected.fastMax) {
    details.push(`${fast.length} fast findings, expected at most ${expected.fastMax}`);
  }
  return details;
}

function evaluateDeep(expected: Expected, deep: Finding[]) {
  const details: string[] = [];
  const codes = codesOf(deep);
  for (const code of expected.deepMustInclude ?? []) {
    if (!codes.includes(code)) details.push(`missing deep code ${code}`);
  }
  for (const code of expected.deepMustExclude ?? []) {
    if (codes.includes(code)) details.push(`unexpected deep code ${code}`);
  }
  return details;
}

async function main() {
  const raw = await fs.readFile(path.join(TESTSET_DIR, "expected.json"), "utf8");
  const parsed = JSON.parse(raw) as { cases: Case[] };
  const cases = parsed.cases;
  const db = getDb();

  const [creator] = await db
    .select()
    .from(users)
    .where(eq(users.role, "creator"))
    .limit(1);
  if (!creator) {
    throw new Error("No creator user found. Run `pnpm db:seed` first.");
  }

  const aiOn = aiConfigured();
  const inserted: string[] = [];
  const results: CaseResult[] = [];
  let expectedFastCodes = 0;
  let foundFastCodes = 0;
  let falsePositives = 0;

  try {
    for (const testCase of cases) {
      const filePath = path.join(TESTSET_DIR, testCase.file);
      const buffer = await fs.readFile(filePath);
      const kind = kindFromFilename(testCase.file);
      if (!kind) throw new Error(`Unknown test case type: ${testCase.file}`);
      const normalized = await normalize({
        kind,
        buffer: kind === "text" ? undefined : buffer,
        text: kind === "text" ? buffer.toString("utf8") : undefined,
        filename: testCase.file,
      });

      const [row] = await db
        .insert(submissions)
        .values({
          brandId: DEFAULT_BRAND_ID,
          creatorId: creator.id,
          title: `eval: ${testCase.title}`,
          status: "draft",
          sourceKind: kind,
          normalized,
        })
        .returning();
      if (!row) throw new Error(`Could not insert ${testCase.file}`);
      inserted.push(row.id);

      const started = await startReview(row.id, { waitForDeep: aiOn });
      const review = await latestReview(row.id);
      const allRows = review
        ? await db.select().from(findings).where(eq(findings.reviewId, review.id))
        : [];
      const all = allRows.map(rowToFinding);
      const deep = all.filter((finding) => finding.tier === "deep");
      const fast = started.fast;

      const details = evaluateFast(testCase.expected, fast);
      if (aiOn && review?.deepStatus === "done") {
        details.push(...evaluateDeep(testCase.expected, deep));
      } else if (aiOn && review?.deepStatus === "failed") {
        details.push("deep tier failed");
      }
      if (review?.score === null || review?.score === undefined) {
        details.push("no score produced");
      }

      const fastCodes = codesOf(fast);
      const include = new Set(testCase.expected.fastMustInclude ?? []);
      expectedFastCodes += include.size;
      foundFastCodes += fastCodes.filter((code) => include.has(code)).length;
      falsePositives += fastCodes.filter((code) => !include.has(code)).length;

      results.push({
        file: testCase.file,
        pass: details.length === 0,
        fastCount: fast.length,
        fastCodes,
        deepStatus: review?.deepStatus ?? "missing",
        deepCodes: codesOf(deep),
        score: review?.score ?? null,
        details,
      });
    }
  } finally {
    const reviewRows = inserted.length
      ? await db
          .select()
          .from(reviews)
          .where(inArray(reviews.submissionId, inserted))
      : [];
    const reviewIds = reviewRows.map((review) => review.id);
    if (reviewIds.length) {
      await db.delete(findings).where(inArray(findings.reviewId, reviewIds));
      await db.delete(reviews).where(inArray(reviews.id, reviewIds));
    }
    if (inserted.length) {
      await db
        .delete(activityLog)
        .where(inArray(activityLog.submissionId, inserted));
      await db.delete(submissions).where(inArray(submissions.id, inserted));
    }
    await getSql().end({ timeout: 5 });
  }

  console.log("\nVerity eval\n");
  for (const result of results) {
    const status = result.pass ? "PASS" : "FAIL";
    console.log(
      `${status} ${result.file} · fast ${result.fastCount} [${result.fastCodes.join(", ") || "none"}] · deep ${result.deepStatus}${
        result.deepCodes.length ? ` [${result.deepCodes.join(", ")}]` : ""
      } · score ${result.score ?? "n/a"}`,
    );
    for (const detail of result.details) console.log(`  - ${detail}`);
  }

  const passed = results.filter((result) => result.pass).length;
  const scores = results
    .map((result) => result.score)
    .filter((score): score is number => score !== null);
  const averageScore = scores.length
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : null;

  console.log("\nSummary");
  console.log(`  cases: ${passed}/${results.length} passed`);
  console.log(
    `  fast source-code recall: ${foundFastCodes}/${expectedFastCodes || 0}`,
  );
  console.log(`  fast unexpected codes: ${falsePositives}`);
  console.log(
    `  average score: ${averageScore === null ? "n/a" : averageScore.toFixed(1)}`,
  );
  if (aiOn) {
    const deepResults = results.filter(
      (result) => result.deepStatus === "done",
    );
    const deepPassed = deepResults.filter((result) => result.pass).length;
    console.log(
      `  deep: ${deepPassed}/${deepResults.length} completed cases passed`,
    );
  } else {
    console.log("  deep: N/A (external AI is not configured)");
  }

  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
  try {
    await getSql().end({ timeout: 1 });
  } catch {
    // ignore
  }
});
