# Decisions

- Next.js 16 (create-next-app current) instead of pinning 14; App Router still matches the prompt.
- `cacheComponents` and `partialPrefetching` turned off so auth cookies and review polling stay request-time.
- next-auth v4 Credentials + JWT (prompt route shape); extra deps: `clsx`, `tailwind-merge` for class merging.
- `EMBEDDING_DIM` is a shared constant defaulting to 1536. The schema uses a fixed pgvector dimension so changing it requires a migration.
- `pnpm db:seed` embeds seeded guideline sections and approved claims when embeddings are configured. Brand-admin sections and claims are embedded on create/update. Without embeddings, retrieval falls back to keyword search and the disclosure log says so.
- The demo submission is pre-normalized by hand so first run is not empty before the normalizer exists.
- The application supports Node.js 20. `unpdf` is pinned to `1.0.6` because `unpdf` 2.x requires Node 24, and Vitest is pinned to `4.x` because Vitest 5 requires Node 22+ APIs.
- Brand admin supports add and delete only. Existing rules are edited in `src/server/db/seed-data/brand.json` and re-seeded; there is no inline edit UI.
- Source-or-silence allows cited codes from guideline sections, approved claims, and the verified-claims set. This lets contradicted claims cite `AC-x` without being dropped. Claim rewrites must be contained inside a retrieved approved claim; otherwise the suggestion is omitted.
- Deep-tier calls use two retries with exponential backoff. Findings are persisted after the claim phase and again after the tone phase so the UI can poll partial progress.
- The deep disclosure count includes embedding calls made for retrieval. The fast tier always reports zero external calls.
- Apply-fix runs the `edit_content` workflow transition. An approved submission becomes `draft` rather than staying approved with stale content.
- The review layout switches to two columns at 860px, matching the prompt, not Tailwind's default `lg` breakpoint.
- `pnpm eval` runs fast-only when AI is unavailable and reports deep metrics as `N/A`. It requires a migrated, seeded database and cleans up its temporary submissions.
- Binary fixtures for parser tests and the eval testset are committed because they are small and keep tests deterministic.
- Database-backed response cache (T9) was deferred in favor of claim & tone batching (T4) and pre-embedding. Batching reduced call volume by ~85% (from 27 calls to 3 calls on the demo submission) without requiring cache invalidation complexity or extra database migrations across brand rule edits. The "Retry deep checks" endpoint and UI button were implemented to allow instant recovery from rate limits, timeouts, or transient outages.
