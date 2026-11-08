# Verity AI Architecture & Provider Integration Guide

Verity is designed for production reliability with strict quota governance, defense against provider instability, and guaranteed fast results even when AI is unavailable.

---

## 1. Overview & Principles

1. **Fast Tier First:** Deterministic rules (glossary, forbidden terms, voice guidelines) run instantly with **zero external AI calls**. Fast checks remain 100% operational when `AI_ENABLED=false` or when providers are down.
2. **Retrieve Before Judgement:** Claims are matched against retrieved approved claims and guidelines before querying the model.
3. **Source or Silence:** The pipeline rejects hallucinated sources and ensures all findings cite verified sources and match verbatim document excerpts.
4. **Budget & Concurrency Governance:** A multi-layered guard controls rate limits, concurrency, and circuit breaks before calls hit provider endpoints.

---

## 2. Environment Variables & Defaults

| Variable | Default | Recommended Free-Tier | Description |
|---|---|---|---|
| `AI_ENABLED` | `true` | `true` / `false` | Master switch. When `false`, deep checks are skipped. |
| `AI_BASE_URL` | — | — | OpenAI-compatible endpoint (e.g., `https://generativelanguage.googleapis.com/v1beta/openai`). |
| `AI_API_KEY` | — | — | Provider API key (never logged, exposed, or committed). |
| `AI_MODEL` | — | — | Model name for chat completions (e.g. `gemini-2.5-flash`). |
| `AI_FALLBACK_MODEL` | — | — | Optional secondary model if primary encounters errors. |
| `EMBEDDING_MODEL` | — | — | Embedding model (e.g. `gemini-embedding-001` or `text-embedding-3-small`). |
| `EMBEDDING_DIM` | `1536` | `1536` | pgvector dimensionality matching DB schema. |
| `RETRIEVAL_MIN_SIM` | `0.30` | `0.30` | Cosine similarity threshold for vector retrieval. |
| `AI_TIMEOUT_MS` | `30000` | `45000` | Timeout per HTTP request (concurrency queue time excluded). |
| `AI_MAX_RETRIES` | `2` | `1` | Max retries for transient errors (`timeout`, `503`, `rate_limited`). |
| `AI_MAX_CONCURRENCY` | `2` | `1` | Max concurrent HTTP requests in flight process-wide. |
| `AI_RPM_LIMIT` | `10` | `5` | Requests per minute token bucket limiter (`0` disables). |
| `AI_BREAKER_COOLDOWN_MS` | `300000` | `300000` | Breaker pause duration (5 minutes) after quota or auth failure. |
| `AI_CLAIM_BATCH_SIZE` | `6` | `6` | Number of candidate sentences grouped per chat request. |
| `AI_TONE_CHUNK_CHARS` | `6000` | `6000` | Text chunk character budget for voice/tone analysis. |
| `EMBED_BATCH_SIZE` | `32` | `16` | Text count per batched embedding call. |
| `AI_DEEP_BUDGET_MS` | `120000` | `120000` | Per-review deadline. Past this, review halts cleanly with fast results. |
| `AI_DEEP_STALE_MS` | `300000` | `300000` | Watchdog threshold to mark abandoned reviews `interrupted`. |
| `AI_CACHE_TTL_DAYS` | `7` | `7` | Retention window for cached verdicts. |

---

## 3. Quota Governance & Circuit Breaker (`aiGuard`)

All external provider traffic flows through `src/server/ai/guard.ts`:

- **Token Bucket Limiter (`AI_RPM_LIMIT`):** Smooths request bursts without failing. Calls wait for refill tokens rather than hitting HTTP 429s.
- **Concurrency Limiter (`AI_MAX_CONCURRENCY`):** Limits simultaneous socket usage to prevent connection exhaustion.
- **Circuit Breaker:**
  - **Terminal Errors (`quota_exceeded`, `auth`, `model_not_found`):** Trips immediately for `AI_BREAKER_COOLDOWN_MS` (5 minutes). Subsequent calls reject locally with `AiError("breaker_open")` without making network requests.
  - **Transient Errors (`provider_unavailable`, `rate_limited`):** Trips after 3 consecutive failures for 60 seconds.
  - **Self-Healing:** After cooldown expires, the breaker enters `half-open` and permits a single probe call. A successful probe closes the breaker.

Inspect the breaker status via `aiGuard.state()` or `GET /api/health`.

---

## 4. Call Budget & Batching (v2)

For a standard 10-sentence, 10,000-character document:

| Operation | Previous Architecture | Verity v2 |
|---|---|---|
| **Embeddings** | 1 call per sentence (10 calls) | **1 batched call** (`EMBED_BATCH_SIZE=32`) |
| **Claim Verdicts** | 1 chat call per sentence (10 calls) | **2 batched calls** (`AI_CLAIM_BATCH_SIZE=6`) |
| **Tone Analysis** | 7 calls (1,500 chars/chunk) | **1–2 calls** (`AI_TONE_CHUNK_CHARS=6000`) |
| **Total Calls** | **~27 calls** (up to ~200 on retry loops) | **~4–5 calls** (0 on cache hit) |

---

## 5. Pre-flight Verification Tool

Run the built-in diagnostic suite to validate provider connectivity, models, embeddings, and pgvector schema:

```bash
pnpm ai:check
```

Outputs a checklist covering:
1. Environment sanity and key masking
2. Reachability of `GET /models`
3. JSON-mode schema conformance
4. Vector embedding dimensionality versus `EMBEDDING_DIM`
5. Database `approved_claims.embedding` column alignment
