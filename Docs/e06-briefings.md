# E06-A2 first-visit briefing

This slice shows a short sourced "First visit" block on a revealed restaurant challenge. It lists parking, arrival, what to expect, typical visit duration, and attire or accessibility only when a fact is stored. Every shown fact has an https source link and a "Checked" date in America/Chicago. A missing fact is omitted. If a restaurant has no active facts, the block is absent and the card matches the flag-off page.

`E06_BRIEFINGS_ENABLED` is server-only. Only the exact string `true` turns the block on. Unset, the challenges page does not query `restaurant_briefing_facts`. Unsetting the flag hides the block without a code change. This slice does not call a model from the page. It does not write credits, XP, verified visits, badges, bookings, or offers.

## What is stored

`restaurant_briefing_facts` has one row per restaurant and field. `body` is the fact text (1–400 characters). `source_url` is https only. `last_verified_at` is required. `status` is `active` or `paused`, and the default is `paused`. Client roles can select active rows and cannot insert, update, or delete. `service_role` writes. `is_sample` marks local fixtures. The UI shows "Sample" only when that column is true.

`content_sources` is unchanged. This slice does not register venue pages there.

## Sample data

`scripts/fixtures/e06-sample-briefings.ts` and `scripts/seed.ts` insert local sample rows for Hutchins BBQ (`is_sample = true`) with `example.com` links and fictional wording. Parking, arrival, and duration are active. Accessibility is paused and must not render. The other seeded restaurants have no facts. The migration does not insert these rows.

## Research script

`npm run research:briefings` (`scripts/research-briefings.ts`) is an operator dry-run. It reads active restaurants, fetches public https pages (an official-looking host first, then a reputable listing), and asks Claude Haiku `claude-haiku-4-5-20251001` for facts the page text supports. A fact is kept only when its `source_url` is https and was fetched in that run, and when words from the fact appear on that page. Anything else is dropped. The script logs token usage and an estimated cost per restaurant. The cap is 25 restaurants and 2.00 USD (lower with `--limit` or `--cost-cap-cents`; the cost ceiling cannot exceed 5.00 USD).

The report is JSON and markdown under `.briefings/` (gitignored). `--write` inserts `status = paused` and `is_sample = false`. It does not activate a row. An existing row for that restaurant and field is left alone. Hosted reads and writes are refused unless `WANDERBITE_BRIEFINGS_HOSTED_OK=1` for that run. [#131](https://github.com/noahjdevine/wanderbite/pull/131) did not run the script against hosted and did not set that variable. The printed cost is an estimate from the published Haiku rates. The script does not write the member AI ledger.

Restaurants have no website column. The script discovers candidate URLs from a public web search and then fetches them. A search result that is neither an official-looking host nor a reputable listing is not fetched.

## Hosted

Migration `20261105174040_e06_a2_restaurant_briefings.sql` is not applied to hosted. Do not run `supabase db push` or `npm run types:db` for this slice. Checked-in `src/types/database.types.ts` and `src/lib/schema-contract.ts` were hand-edited for the new table. `npm run types:db` is a separate approved PR. The table is additive. Revert this PR to remove the code. If the migration is applied later, the table is unused once the code is reverted. No drop is required for that rollback.

## Local check

Apply the migration on a local database, then:

```bash
npm run seed
```

Set `E06_BRIEFINGS_ENABLED=true` in `.env.local` and open a challenge for Hutchins BBQ and one for a seeded restaurant with no facts. Hutchins shows First visit with parking, arrival, and duration, each with Source and Checked in America/Chicago, plus Sample. Attire and accessibility are absent. The other restaurant has no First visit block. Unset `E06_BRIEFINGS_ENABLED` and the block is gone, with no briefing query.

Do not point this seed or `npm run research:briefings` at hosted.
