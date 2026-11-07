# Verity

Verity is a brand-review workspace for marketing copy. It catches rule-based issues before using AI, cites the source for every finding, and leaves the final decision with a human.

## Principles

- Rules before AI: glossary, terminology, and voice rules run first with zero external calls.
- Retrieval before judgement: claim checks retrieve the brand's approved claims and guideline sections before asking the model anything.
- Source or silence: a finding is only kept when it cites an existing source and quotes text that actually appears in the submission.
- Confidence honesty: findings below `0.60` confidence become questions, not errors.
- Humans decide: approval is explicit; nothing is auto-approved or auto-rejected.
- Disclosure: the review log reports which tiers ran, which models were used, how many external calls were made, and what was sent.

## Stack

- Next.js 16 App Router, React 19, TypeScript strict
- Tailwind CSS v4
- Drizzle ORM + PostgreSQL with pgvector
- NextAuth v4 Credentials + JWT
- zod v4, unpdf, mammoth, sharp
- Vitest

Requires Node.js 20.9+ and pnpm.

## Setup

```bash
pnpm install
docker compose up -d
cp .env.example .env
```

Set `NEXTAUTH_SECRET` and `SEED_USER_PASSWORD` in `.env`, then create the database schema and seed the demo brand:

```bash
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open http://localhost:3000 and sign in with one of the seeded users:

- `creator@kettle.test`
- `reviewer@kettle.test`
- `admin@kettle.test`

Use the password from `SEED_USER_PASSWORD`. In development the role switcher can impersonate any seeded user.

### AI is optional

Leave `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, and `EMBEDDING_MODEL` empty to run in fast-only mode. Reviews still run, the disclosure log says `Deep checks off: external AI disabled`, and the score is based on fast-tier findings.

To enable deep checks, point the app at any OpenAI-compatible chat and embeddings API:

```env
AI_ENABLED=true
AI_BASE_URL=https://your-provider.example/v1
AI_API_KEY=...
AI_MODEL=...
EMBEDDING_MODEL=...
EMBEDDING_DIM=1536
```

`pnpm db:seed` embeds the seeded sections and approved claims when embeddings are configured. Brand-admin additions are embedded on create.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the app in development |
| `pnpm build` | Production build |
| `pnpm start` | Start the production server |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run TypeScript without emitting |
| `pnpm test` | Run the Vitest suite |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Seed users, brand rules, demo submission, and embeddings |
| `pnpm eval` | Run the testset through the review pipeline |

### Evaluation

`pnpm eval` loads 10 documents from `src/server/db/seed-data/testset/` (7 text, 2 DOCX, 1 PDF) plus `expected.json`. It inserts temporary submissions, runs the real review pipeline, compares findings against the expected source codes, prints per-case results and summary metrics, then deletes the temporary data.

The eval requires a migrated and seeded database. When AI is not configured, deep metrics are reported as `N/A`; fast-tier checks and expectations still run.

## How a review works

1. A submission is normalized into blocks (text, PDF, DOCX, or image metadata).
2. The fast tier loads the brand glossary and guideline sections, matches terminology and style rules, and filters findings through source-or-silence.
3. If AI is configured, the deep tier retrieves approved claims and relevant guideline sections, then checks claims and tone. Findings are persisted progressively so the UI can poll for partial results.
4. Every finding carries a source (`CODE`, category, and snapshot text), a confidence value, and an optional suggestion.
5. Creators can apply or dismiss findings. Applying a fix edits the text and returns an approved submission to draft so it cannot silently stay approved. Dismissals require a reason and are recorded in the activity log.
6. Reviewers approve or request changes. The approval banner names the reviewer from the activity log.

## Brand rules

Everyone can read brand rules. Admins can add and delete guideline sections, glossary terms, approved claims, and brand colours from `/brand`. Existing rules are edited in `src/server/db/seed-data/brand.json` and re-seeded.

## Docs

- [API](docs/API.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Decisions](docs/DECISIONS.md)

## Limitations

- Scanned PDFs need OCR; the app reports when no text is extractable.
- Visual/colour checking is not part of this round (`ENABLE_VISION` is reserved).
- Images in DOCX files are shown inline, but image-based review is not implemented.
- Deep-tier results depend on the configured model and can fail; the UI shows a partial-result banner and the fast score remains available.
