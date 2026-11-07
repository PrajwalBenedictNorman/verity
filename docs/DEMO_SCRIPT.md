# Demo script

A short walkthrough for showing Verity. Use the seeded Kettle & Co. brand.

## Before the demo

```bash
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Sign in as `creator@kettle.test` using `SEED_USER_PASSWORD`. Keep a second browser profile or the role switcher ready for the reviewer and admin steps.

If you want deep checks, make sure the AI variables are set before seeding so brand embeddings are created. If you want a fast-only demo, leave them empty; the UI will say deep checks are off.

## 1. Start with the creator

1. Open `/` and choose **New submission**.
2. Paste the demo copy:

   > Kettle & Co. Monsoon Blend
   >
   > Our BEST tea bags in India!! Loved by tea drinkers everywhere, and cheap too.
   >
   > Every pouch is sourced from over 50 estates across Assam and Darjeeling, and it is 100% organic. Packaging is 100% recyclable. Ask any of our clients.

3. Run the review.

Point out:

- Fast-tier findings appear first.
- `BEST` and `!!` cite the voice guideline.
- `tea bags`, `cheap`, and `clients` cite the terminology guidelines.
- The source box shows the source code, category, and the guideline snapshot.
- Findings below `0.60` confidence would be questions, not errors.

If AI is on, wait for the deep tier. It should flag the `over 50 estates` claim against approved claim `AC-1`, which says 14 partner estates. The review log reports retrieval mode, models, external calls, dropped findings, and verified claims.

## 2. Fix and dismiss

1. Apply the `tea bags` fix. The document text updates and a new review starts.
2. Apply or dismiss a voice finding. Dismissing requires a reason.
3. Show that the score recalculates and the activity log records the decision.

If the submission was approved, point out that applying a fix returns it to draft instead of leaving stale approval in place.

## 3. Submit

1. Fix or dismiss findings until the score is at or above the ready threshold, or submit below it and explain the dismissals.
2. Choose **Submit for review**.

## 4. Reviewer decision

Switch to `reviewer@kettle.test`.

1. Open the submission.
2. Check the document/finding highlights and reverse scrolling: click a highlighted phrase to jump to its card, or click a card to jump back to the text.
3. Choose **Approve**. The banner should name the reviewer from the activity log.
4. Optionally reopen the submission as the creator and show that editing returns it to draft.

## 5. Brand admin

Switch to `admin@kettle.test` and open **Brand rules**.

1. Add a glossary term or approved claim.
2. Delete it.
3. Point out that non-admins see the same rules read-only and that rule editing in this round is add/delete only.

## 6. Fast-only fallback

If AI is unavailable:

1. Run a review.
2. Show the "Deep checks off: external AI disabled" message.
3. Show the review log reporting fast external calls as zero and deep metrics as off.
4. Run `pnpm eval`; deep metrics should print as `N/A`, while the fast cases still pass or fail normally.

## 7. Tests and eval

```bash
pnpm test
pnpm typecheck
pnpm eval
```

`pnpm eval` reads the 10-document testset, runs the real pipeline, prints per-case results, and removes its temporary submissions.
