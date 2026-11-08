# Troubleshooting & Operations Guide

This guide covers common diagnostic patterns, error codes, and operational fixes for Verity.

---

## 1. Architectural Diagnosis: What Was Fixed (v2)

| # | Finding | Cause & Symptoms | Solution Implemented |
|---|---|---|---|
| **F1** | Retries multiply | Nested retry loops in adapter and orchestrator burned quotas (up to 9 calls/sentence on 503/429). | Unified in `withRetries` (`src/server/review/deep/retry.ts`). 429 daily quota is never retried. |
| **F2** | Sequential chat per sentence | 10 sentences made 10 sequential chat completions. | Claim verdicts are batched (`AI_CLAIM_BATCH_SIZE=6`) with indexed array schemas. |
| **F3** | Sentence-by-sentence embedding | Embeddings called per-sentence even after failures. | Single batch embedding (`EMBED_BATCH_SIZE=32`) per review with keyword fallback on error. |
| **F4** | Small tone chunks (1500 chars) | A 10k document created 7 tone completion calls. | Tone chunk size raised to `AI_TONE_CHUNK_CHARS=6000` (default). |
| **F5** | Uncounted schema repair calls | Schema correction and JSON-fallback requests were omitted from `externalCalls`. | Adapter reports exact HTTP requests via `calls` in `AiCompleteResult` and `AiEmbedResult`. |
| **F6** | Lost call counts on failure | Call counts were only aggregated if deep tier completed without error. | `DeepStats` context survives failure and records actual attempts in `disclosure.deep`. |
| **F7** | Raw provider error exposure | Provider response bodies leaked into `disclosure.log` and user screens. | Redaction, safe error codes, and sanitized UI text via `userMessageFor(code)`. |
| **F8** | Unclassified errors | 404, 401, daily 429, and 503 were treated as generic errors. | Distinct classification (`AiErrorCode`) with tailored retry and breaker behaviors. |
| **F9** | Adapter recreation lost state | Ephemeral adapter instances could not maintain concurrency or rate limits. | Module-level singleton `aiGuard` tracks concurrency, RPM token bucket, and circuit breaker. |
| **F10** | Seed embeddings swallowed errors | Seed embedding silently failed when AI was off or quota was exceeded. | Explicit return types, `pnpm db:embed` script, and clear terminal reporting. |
| **F11** | Stuck reviews | Fire-and-forget deep review promises left reviews stuck in `running` across restarts. | Watchdog in `latestReview` transitions reviews older than `AI_DEEP_STALE_MS` to `interrupted`. |
| **F12** | Duplicate `EMBEDDING_DIM` | Defined separately in `lib/config.ts` and `db/schema.ts`. | Single source of truth in `src/lib/config.ts`, imported relatively in `schema.ts`. |

---

## 2. Common Errors and Resolutions

### Error: `Docker is not running` / Cannot connect to Docker daemon
- **Symptom:** `docker compose up -d` fails with connection errors.
- **Fix:** Launch Docker Desktop (or start Docker service via systemd) and verify with `docker ps`.

### Error: `.env missing` or variables unset
- **Symptom:** `DATABASE_URL is not set` or `NEXTAUTH_SECRET is not set`.
- **Fix:** Copy `.env.example` to `.env` and provide the required secrets:
  ```bash
  cp .env.example .env
  ```
  Ensure `NEXTAUTH_SECRET` is populated (e.g., `openssl rand -base64 32`).

### Error: `SEED_USER_PASSWORD is not set`
- **Symptom:** `pnpm db:seed` throws `SEED_USER_PASSWORD is not set`.
- **Fix:** Add a non-empty password to `.env`:
  ```env
  SEED_USER_PASSWORD=your-secure-password
  ```

### Error: Vector Dimension Mismatch (`atttypmod != EMBEDDING_DIM`)
- **Symptom:** `ERROR: different vector dimensions` during retrieval or embedding insert.
- **Cause:** Database column `embedding` was migrated with a different dimension than `EMBEDDING_DIM` in `.env`.
- **Fix:** Run pre-flight check:
  ```bash
  pnpm ai:check
  ```
  If changing `EMBEDDING_DIM`, update migrations or recreate the column, then run `pnpm db:embed`.

### Using a Hosted Database
Hosted cloud databases (e.g., Neon) introduce significant network latency (~2.3 s per query, leading to ~8 s fast review response times). For development, automated tests, and live demonstrations, use the local Docker Postgres instance (`postgres://verity:verity@127.0.0.1:5432/verity`) to achieve sub-second review feedback and avoid IPv6 resolution delays.

---

## 3. AI Error Codes (`AiErrorCode`)

| Code | HTTP Status | Meaning | Retryable? | Safe UI Message |
|---|---|---|---|---|
| `quota_exceeded` | 429 | Daily, monthly, or billing limit reached (`limit: 0`). | **No** | The AI provider's usage quota is used up. Fast results are shown. Try again later or use another model or key. |
| `rate_limited` | 429 | Per-minute request or token limit reached. | **Yes** (if `Retry-After <= 20s`) | The AI provider is rate limiting requests. Fast results are shown. |
| `provider_unavailable` | 500/502/503/504 | Provider server error or outage. | **Yes** (exponential backoff) | The AI provider is temporarily unavailable. Fast results are shown. |
| `timeout` | 408 / Abort | Provider took longer than `AI_TIMEOUT_MS`. | **Yes** (1 retry max) | The AI provider could not be reached in time. Fast results are shown. |
| `network` | Fetch fail | Network disconnect or DNS failure. | **Yes** | The AI provider could not be reached in time. Fast results are shown. |
| `model_not_found` | 404 | Configured `AI_MODEL` does not exist on provider. | **No** | The configured AI model was not found. An admin should check AI_MODEL. |
| `auth` | 401 / 403 | Invalid, expired, or unauthorized API key. | **No** | The AI provider rejected the credentials. An admin should check AI_API_KEY. |
| `breaker_open` | Local | Circuit breaker is active after repeated errors. | **No** (tripped locally) | AI checks are paused after repeated provider errors. Fast results are shown. |
| `interrupted` | Local watchdog | Review process restarted or timed out. | **No** | Deep checks were interrupted. Fast results are shown. |

---

## 4. Querying Provider Models with `curl` (Safe Pattern)

To query available model names without exposing keys in shell history or chat logs:

```bash
# Read key from your environment or prompt interactively
read -s AI_KEY
curl -s -H "Authorization: Bearer $AI_KEY" "https://generativelanguage.googleapis.com/v1beta/openai/models" | jq .
```

Or run Verity's automated pre-flight tool:
```bash
pnpm ai:check
```
This safely masks all keys and suggests available model IDs if your configured model is missing.
