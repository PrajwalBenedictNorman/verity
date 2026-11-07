# API

All JSON routes return one of these envelopes:

```json
{ "ok": true, "data": ... }
```

```json
{ "ok": false, "error": { "code": "forbidden", "message": "Not allowed" } }
```

Errors use `400` for validation/bad requests, `401` for missing sessions, `403` for permissions, `404` for missing records, `409` for conflicts or unsupported edits, and `500` for unexpected failures.

## Auth

- `POST /api/auth/[...nextauth]` — NextAuth Credentials sign-in and session endpoints.
- `POST /api/dev/impersonate` — development only; body `{ "email": "reviewer@kettle.test" }` sets the session cookie for a seeded user. Returns `404` in production.

## Submissions

### `GET /api/submissions`

Lists submissions visible to the current user, with creator name and latest score. Creators see their own submissions; reviewers and admins see all.

### `POST /api/submissions`

Creates a submission. Requires `submissions.create` (creator or admin).

- JSON: `{ "title": string, "text": string }`
- Multipart: `title`, optional `file` (`text`, `.pdf`, `.docx`, or image), or `text`

Returns `201` with `{ id }`.

### `GET /api/submissions/[id]`

Returns the submission, creator name, `approvedBy`, `activity`, `latestReview`, and findings. Requires `submissions.read`.

### `PATCH /api/submissions/[id]`

Replaces pasted text and re-normalizes it. Requires ownership and `submissions.edit`. Editing an approved submission returns it to `draft`.

Body: `{ "text": string }`

### `POST /api/submissions/[id]/review`

Starts a new review. Requires `submissions.review` (creator owner or admin). Returns `{ reviewId, fast, deepStatus }`. The deep tier continues in the background when AI is configured.

### `POST /api/submissions/[id]/transition`

Moves a submission through the workflow. Body: `{ "action": "submit" | "approve" | "request_changes", "note"?: string }`.

- `submit` requires a finished, skipped, or failed review.
- `approve` and `request_changes` require the reviewer role.
- Every transition is written to the activity log.

## Reviews

### `GET /api/reviews/[id]`

Polling endpoint for a review. Returns `deepStatus`, `score`, `findings`, `discarded`, `verified`, `disclosure`, `log`, `fastMs`, and `deepMs`.

Deep status is one of `pending`, `running`, `done`, `skipped`, or `failed`. Findings may appear progressively while the deep tier runs.

## Findings

### `POST /api/findings/[id]/apply`

Applies the finding's suggestion to pasted text, marks the finding `applied`, applies the `edit_content` workflow transition (an approved submission returns to `draft`), logs the edit, and starts a fresh review.

Only available for text submissions and findings with a suggestion.

### `POST /api/findings/[id]/dismiss`

Body: `{ "reason": string }` (minimum 3 characters). Marks the finding dismissed, recalculates the latest review score, and records the reason in the activity log.

### `POST /api/findings/[id]/restore`

Restores a dismissed finding to `open`, clears the reason, recalculates the score, and logs the action.

## Brand rules

Read routes require `brand.read` (all signed-in users). Create, update, and delete routes require `brand.edit` (admin only).

| Route | Methods | Body |
| --- | --- | --- |
| `/api/brand/sections` | `GET`, `POST` | `{ code, category, title, body }` |
| `/api/brand/sections/[id]` | `PATCH`, `DELETE` | Partial section fields |
| `/api/brand/glossary` | `GET`, `POST` | `{ code, badTerm, preferredTerm, matchMode?, caseSensitive?, note? }` |
| `/api/brand/glossary/[id]` | `PATCH`, `DELETE` | Partial term fields |
| `/api/brand/claims` | `GET`, `POST` | `{ code, text, tags? }` |
| `/api/brand/claims/[id]` | `PATCH`, `DELETE` | Partial claim fields |
| `/api/brand/colours` | `GET`, `POST` | `{ name, hex, maxDeviation? }` |
| `/api/brand/colours/[id]` | `PATCH`, `DELETE` | Partial colour fields |

Sections and claims are re-embedded on create/update when embeddings are configured. Duplicate section or claim codes return `409`.

The brand UI intentionally supports add/delete only; inline editing is not part of this round.

## Files

### `GET /api/files/[...path]`

Serves stored submission uploads and extracted DOCX images from `STORAGE_DIR`. Requires a signed-in session. Paths are resolved inside `STORAGE_DIR`.
