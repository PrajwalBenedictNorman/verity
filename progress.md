# Progress

Last updated: 2026-11-07

## Status

Code follow-ups are done. Lint, typecheck, unit tests, and `pnpm build` pass. Database migrate, seed, and eval still need a running Postgres. Docker Desktop was started, but the engine never opened `~/.docker/run/docker.sock`.

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

## Done in this pass

- `05-spelling.txt` now uses `clents` (a one-edit miss of `clients`, GL-2.3). The short-term fuzzy guard stays in place. Fast-rules tests cover the near-miss and the `cheap`/`cheep` non-match.
- `ReviewScreen` reloads the new review after Run review, refreshes the editor draft from normalized blocks, and surfaces dismiss/restore errors.
- Tailwind utilities are compiled through `@tailwindcss/postcss`.
- `pnpm test` (29), `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass.

## Pending

- Start Docker Desktop until `docker info` connects, then `docker compose up -d`, `pnpm db:migrate`, `pnpm db:seed`, and `pnpm eval`.
- If AI is configured, confirm the deep `AC-1` expectation for `04-claims.txt`.
- Do not commit unless explicitly requested.

## Known caveats

- `pnpm build` passes. `pnpm eval` has not been run because Postgres is not reachable.
- The deep-tier eval assertion depends on the configured external model.
- `tests/deep-filter.test.ts` and the `requireApiUser` return-type refinement in `src/server/auth/api.ts` were present in the working tree during inspection; both are benign and tests pass.
- No git commit has been made.
