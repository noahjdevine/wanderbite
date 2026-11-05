# E06-A1 optional nearby activities

This slice adds optional activity suggestions under a member's restaurant challenge. First-visit briefing is E06-A2 and stays behind `E06_BRIEFINGS_ENABLED`. E06-B1 can register a venue or event page and can expire a dated activity. E06-B2 can do that expiry and the venue or event refresh on the existing content-refresh cron, behind `E06_ACTIVITY_MAINTENANCE_CRON_ENABLED` (unset). It does not create bookings, partner accounts, benefits, discounts, credits, XP, badges, or drawing entries. Hiding or changing a suggestion does not swap the restaurant and does not change a challenge item, redemption, offer, or credit.

`E06_ACTIVITIES_ENABLED` is server-only. Only the exact string `true` turns the block on. Unset, the challenges page does not query `activities` and the card matches `main`. Unsetting the flag hides the block without a code change.

## What the catalog is attached to

Restaurants store `lat` and `lon` (`double precision`) and a free-text `address`. There is no restaurant ZIP column. A ZIP is read from the address with the same last-5-digit rule as `zipFromAddress`. Challenge items for the signed-in member are loaded by `getCurrentChallenge` (`getCurrentChallengeForUser` in `src/lib/challenges/generate.ts`) and rendered by `DashboardClient` → `RestaurantCard` on `/challenges` and `/dashboard`. E04 reveal adds reason and deadline copy on that same card when its flag is on. This slice does not change that query. `loadActivitySuggestions` runs beside it and returns before opening a client when the flag is off.

`content_sources.kind` allows `venue_page` and `event_page`. E06-B1 registers and dry-run refreshes those kinds. `source_facts.subject_type` and `content_exceptions.subject_type` accept `activity` beside `recipe`. `activities.content_source_id` is an optional link to that source. When it is null, refresh matches the activity by its https `source_url`. The migration does not insert source rows.

## Matching

`src/lib/activities/match.ts` returns at most two activities. A row must be `active`, inside its Chicago dates (`valid_until` null or today or later; `valid_from` null or today or earlier), have an `https` `source_url`, and have `last_verified_at` within 30 days (`ACTIVITY_STALE_AFTER_MS`). Unknown `hours_note` is shown as "Check hours on their site" and is not an exact schedule. A missing URL or a stale or missing verification drops the row. Zero matches render nothing.

When the restaurant and the activity both have coordinates, distance is haversine miles from the restaurant. Nearby is capped at 5 miles. The bound is the member's saved `distance_band` (5, 15, 25, or 40) and that cap, so a 40-mile band still stops at 5. A missing or unknown band uses min(15, 5), which is 5. The band is not expanded. This is not the member's home travel band. When either side lacks coordinates, the match is the same ZIP or another launch ZIP in `LAUNCH_ADJACENT_ZIPS` (75069, 75070, 75071, 75072). That list is not a drive time and not a ZIP-centroid distance, and the 5-mile cap does not apply to it. Coordinate matches sort ahead of ZIP matches, then by miles or same-ZIP before adjacent, then name, then id.

There is no saved time-budget field on the member. Duration is displayed and not used as a filter. `weather_dependent` and `booking_required` are labels only.

## Sample data

`scripts/fixtures/e06-sample-activities.ts` and `scripts/seed.ts` insert local sample rows (`is_sample = true`) with `example.com` links and fictional names. They are not real venues. The migration does not insert them. The UI shows "Sample" whenever `is_sample` is true, and on every suggestion when `NODE_ENV` is not `production`.

## Hosted

Migration `20261104060000_e06_a1_activities.sql` was applied on hosted after Noah confirmed it on 2026-11-04. Migration `20261105193652_e06_b1_activity_pipeline.sql` is applied to hosted (2026-11-05). The filename matches the hosted `schema_migrations` version. `E06_ACTIVITIES_ENABLED` stays unset. Do not run `supabase db push` or `npm run types:db` for this slice. Checked-in `src/types/database.types.ts` and `src/lib/schema-contract.ts` were hand-edited for `activities.content_source_id` and the activity fact helpers. The change is additive. Revert this PR to remove the code. Once the code is reverted, the added column and helpers are unused. No drop is required for that rollback.

## Local check

Apply the migration on a local database, then:

```bash
npm run seed
```

Set `E06_ACTIVITIES_ENABLED=true` in `.env.local` and open a challenge whose restaurant is near the seeded coordinates (about 33.197, -96.616, ZIP 75069) with distance band 15 miles. Two sample ideas within 5 miles show, each with the optional / independently operated / may-cost-extra line. Sample Hall Museum is about 21 miles away and does not show, including on a 40-mile band. Expire the dated sample and reload:

```bash
npm run content:refresh -- --expire
WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --expire --apply
```

Dry-run prints the row and writes nothing. `--apply` sets `status` to `expired`. The same row disappears from match. Do not point expire at hosted.

Or set the date directly:

```sql
update public.activities
set valid_until = (timezone('America/Chicago', now()))::date - 1
where name = 'Sample Dated Fair';
```

That fair disappears. Unset `E06_ACTIVITIES_ENABLED` and the block is gone, with no activities query.

## Scheduled maintenance

`E06_ACTIVITY_MAINTENANCE_CRON_ENABLED` is server-only. Only the exact string `true` turns it on, and only inside a content-refresh cron that is already enabled with `E05_CONTENT_REFRESH_CRON_ENABLED=true`. Unset, the cron does not query `activities` or `venue_page` / `event_page` sources. Member pages are unchanged. `E06_ACTIVITIES_ENABLED` stays unset.

When both flags are `true`, the run at `0 9 * * *` UTC (03:00 America/Chicago standard time, 04:00 daylight time) marks an active activity `expired` when `valid_until` is before that Chicago date. Today stays active. A null date stays active. The row is not deleted. An `event_page` is fetched when `last_verified_at` is null or older than 1 elapsed day. A `venue_page` is fetched when null or older than 7 elapsed days. Menus keep the first slots in the shared cap of 5 sources, 15 attempts, and one model call per source. Hours, price, and allergen text open `content_exceptions` and are not copied onto the activity. A summary stays `pending_review`. The cron does not insert an activity. If the activity schema is missing, that step logs one skip and the menu refresh still runs. Unset the flag to stop the step. No migration in this slice.

Do not point this seed at hosted.

## Operator review

`/admin/content` is the only review screen. It now includes activity exceptions and pending summary drafts beside recipe rows. Approve marks a summary draft reviewed and publishes nothing. Edit is the only publish path: a summary becomes a new current fact and the prior version stays; an hours note conflict writes `hours_note` and keeps the previous note. Price and allergen text are not stored as a claim. Edit on those rows only closes them with an audit note. Reject closes the item and does not change the activity. Evidence renders as text. A pending summary also shows `change_summary` as plain text beside the current and proposed text. The maintenance call can return that sentence; otherwise the draft stores one line from the previous summary and the new text. An open `pending_review` summary with the same activity and normalized text is not inserted again. Tagging of new activity identities is UNKNOWN. No pending-draft JSON hook for a new venue identity was found, and this slice does not add one. This does not call a model from the page. `E06_ACTIVITIES_ENABLED` stays unset. Migration `20261105204844_e06_b3_activity_review.sql` matches the hosted `schema_migrations` version. This rename does not run `supabase db push` or `npm run types:db`. The checked-in function types were hand-edited. Do not point this queue at hosted.
