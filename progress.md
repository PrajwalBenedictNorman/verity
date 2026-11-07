# Progress

Last updated: 2026-11-06

## Status

Implementation is nearly complete. Lint, typecheck, and the unit test suite pass. Two follow-up fixes remain, and the production build and database-backed eval have not yet been run.

## Completed

### Verification

- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes: 8 files, 28 tests.

### Deep review tier

- Added retry handling for deep-tier AI calls with exponential backoff.
- Added source-code allowlisting across guideline sections, approved claims, and verified claims.
- Added safe claim-rewrite filtering so rewrites must come from retrieved approved claim text.
- Enforced source-or-silence per claim and guideline finding.
- Added JSON-mode fallback for OpenAI-compatible providers that reject `response_format`.
- Added retrieval external-call counting, including embedding calls.
- Persisted claim findings after the claim phase and tone findings after the tone phase, enabling progressive polling.
- Added deep-tier failure handling that preserves partial findings and sets a failed status.
- Added structured disclosure data: provider, models, retrieval mode, external calls, dropped findings, and verified claims.
- Added activity logging around deep reviews.

### Brand admin

- Wired the brand page to real database data and permissions.
- Added editable add/delete controls for sections, glossary terms, approved claims, and colours.
- Added `ColoursTable`.
- Added duplicate-code conflict handling (`409`).
- Scoped glossary, claim, and colour mutations to the default brand.
- Embedded seeded brand sections/claims when embeddings are configured.
- Embedded new/updated claims and sections created through the admin API.
- Added the shared `apiRequest` client helper.

### Review screen

- Added source code, category, and snapshot display to finding cards.
- Added reverse scrolling from findings to document marks and from marks to findings.
- Added stable block marks and finding marks.
- Added DOCX inline images attached to their preceding block, plus trailing-image fallback.
- Added an image-only document state and cells for scanned PDFs.
- Added deep-running and deep-failed states.
- Added structured AI disclosure and activity history to the review log.
- Added `approvedBy` derivation from the latest approval activity.
- Changed the two-column review layout breakpoint to `860px`.
- Added deep-tier status handling so AI-off reviews still expose the fast log and score.

### Apply-fix workflow

- Apply-fix now runs the `edit_content` workflow transition.
- Applying a fix to an approved submission returns it to `draft`, preventing stale approval.
- Applying a fix logs the edit and starts a fresh review.

### Tests and eval

- Added tests for normalization, scoring, workflow transitions, finding validation, fast rules, DOCX block/image mapping, and deep source filtering/rewrite safety.
- Added binary fixtures for PDF and DOCX parser tests.
- Added `scripts/eval.ts` with a 10-document testset (7 text, 2 DOCX, 1 PDF) and `expected.json`.
- Eval inserts temporary submissions, runs the real review pipeline, prints metrics, and cleans up.
- Eval reports deep metrics as `N/A` when AI is not configured.

### Documentation and tooling

- Rewrote `README.md`.
- Added `docs/API.md`.
- Added `docs/DEMO_SCRIPT.md`.
- Updated `docs/DECISIONS.md`.
- Added `typecheck` and `eval` package scripts.
- Pinned `unpdf` to the Node 20-compatible 1.x line and Vitest to 4.x.

## Pending

### 1. Fix the `05-spelling` eval expectation

- `src/server/review/fast/glossary-match.ts:125` skips fuzzy matching for glossary terms of 6 characters or fewer.
- `src/server/db/seed-data/testset/05-spelling.txt:3` uses `cheep` for the 5-character term `cheap`, so no finding is produced.
- `src/server/db/seed-data/testset/expected.json:45` currently requires `GL-2.1`, so `pnpm eval` will fail case 05.
- Recommended fix: use a longer near-miss such as `clents` for `clients` (`GL-2.3`) and add a fast-rules unit test covering fuzzy near-misses and the short-term guard.
- Do not lower the fuzzy-match length guard without addressing false positives such as `cheat`/`heap` matching `cheap`.

### 2. Fix stale review-screen state

- `src/components/review/ReviewScreen.tsx:114` optimistically reuses the previous review's disclosure after starting a new review.
- When the new review is `skipped` (AI off), polling stops, so the stale disclosure, log, and `null` score can remain until a page reload.
- `src/components/review/ReviewScreen.tsx:143` (`reload`) updates findings/status but does not refresh the editor draft from the returned normalized document.
- Fix: replace the optimistic state update in `runReview` with an awaited `reload()`, and update `draft` from the returned normalized blocks during `reload`.
- Optional polish: catch dismiss/restore failures in `ReviewScreen` and clear the error on successful actions.

### 3. Remaining verification

- Run `pnpm build` and fix any production-build failures.
- Run `pnpm db:migrate` and `pnpm db:seed` against a running Postgres instance.
- Run `pnpm eval`; with AI disabled, expect all 10 fast-tier cases to pass and deep metrics to print `N/A`.
- If AI is configured, verify the deep `AC-1` expectation for `04-claims.txt`.
- Do not commit unless explicitly requested.

## Known caveats

- `pnpm build` and `pnpm eval` have not been run yet.
- The deep-tier eval assertion depends on the configured external model.
- `tests/deep-filter.test.ts` and the `requireApiUser` return-type refinement in `src/server/auth/api.ts` were present in the working tree during inspection; both are benign and tests pass.
- No git commit has been made.
