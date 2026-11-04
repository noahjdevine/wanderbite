# E06-A1 optional nearby activities

This slice adds optional activity suggestions under a member's restaurant challenge. It does not brief a first visit (E06-A2) and it does not refresh activities (E06-B). It does not create bookings, partner accounts, benefits, discounts, credits, XP, badges, or drawing entries. Hiding or changing a suggestion does not swap the restaurant and does not change a challenge item, redemption, offer, or credit.

`E06_ACTIVITIES_ENABLED` is server-only. Only the exact string `true` turns the block on. Unset, the challenges page does not query `activities` and the card matches `main`. Unsetting the flag hides the block without a code change.

## What the catalog is attached to

Restaurants store `lat` and `lon` (`double precision`) and a free-text `address`. There is no restaurant ZIP column. A ZIP is read from the address with the same last-5-digit rule as `zipFromAddress`. Challenge items for the signed-in member are loaded by `getCurrentChallenge` (`getCurrentChallengeForUser` in `src/lib/challenges/generate.ts`) and rendered by `DashboardClient` → `RestaurantCard` on `/challenges` and `/dashboard`. E04 reveal adds reason and deadline copy on that same card when its flag is on. This slice does not change that query. `loadActivitySuggestions` runs beside it and returns before opening a client when the flag is off.

`content_sources.kind` already allows `venue_page` and `event_page` (E05-B2, reserved for E06). A later E06-B job can register an activity's official `source_url` there. `source_facts.subject_type` is still `recipe` only. This PR does not insert `content_sources` rows and does not extend that check.

## Matching

`src/lib/activities/match.ts` returns at most two activities. A row must be `active`, inside its Chicago dates (`valid_until` null or today or later; `valid_from` null or today or earlier), have an `https` `source_url`, and have `last_verified_at` within 30 days (`ACTIVITY_STALE_AFTER_MS`). Unknown `hours_note` is shown as "Check hours on their site" and is not an exact schedule. A missing URL or a stale or missing verification drops the row. Zero matches render nothing.

When the restaurant and the activity both have coordinates, distance is haversine miles against the member's saved `distance_band` (5, 15, 25, or 40). A missing or unknown band uses 15 miles, the profile default. The band is not expanded. When either side lacks coordinates, the match is the same ZIP or another launch ZIP in `LAUNCH_ADJACENT_ZIPS` (75069, 75070, 75071, 75072). That list is not a drive time and not a ZIP-centroid distance. Coordinate matches sort ahead of ZIP matches, then by miles or same-ZIP before adjacent, then name, then id.

There is no saved time-budget field on the member. Duration is displayed and not used as a filter. `weather_dependent` and `booking_required` are labels only.

## Sample data

`scripts/fixtures/e06-sample-activities.ts` and `scripts/seed.ts` insert local sample rows (`is_sample = true`) with `example.com` links and fictional names. They are not real venues. The migration does not insert them. The UI shows "Sample" whenever `is_sample` is true, and on every suggestion when `NODE_ENV` is not `production`.

## Hosted

Migration `20261104060000_e06_a1_activities.sql` is not applied to hosted. Do not run `supabase db push` or `npm run types:db` for this slice. Checked-in `src/types/database.types.ts` and `src/lib/schema-contract.ts` were hand-edited to match the new table, the same way E05-B2 recorded its tables. The table is additive. A later forward migration can drop it. Revert this PR to remove the code. Hosted stays unchanged until Noah approves an apply.

## Local check

Apply the migration on a local database, then:

```bash
npm run seed
```

Set `E06_ACTIVITIES_ENABLED=true` in `.env.local` and open a challenge whose restaurant is near the seeded coordinates (about 33.197, -96.616, ZIP 75069) with distance band 15 miles. Two sample ideas show, each with the optional / independently operated / may-cost-extra line. Expire the dated sample and reload:

```sql
update public.activities
set valid_until = (timezone('America/Chicago', now()))::date - 1
where name = 'Sample Dated Fair';
```

That fair disappears. Unset `E06_ACTIVITIES_ENABLED` and the block is gone, with no activities query.

Do not point this seed at hosted.
