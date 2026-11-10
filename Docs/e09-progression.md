# E09 continuing progression

A1 is pure helpers in `src/lib/progression/`. A2 adds the ledger migration and `record_verified_visit_progress`. A3 calls that function after a successful partner verify when `E09_PROGRESSION_LEDGER_ENABLED` is exactly `true`. The flag is unset everywhere. Nothing reads the ledger. No UI change. Journey still uses `levelFromXp` in `src/lib/progress/rules.ts`, which stops at The Local Legend. This does not claim E09, E07, or E02 acceptance.

## Schedule v1

`PROGRESSION_SCHEDULE_VERSION` is `v1`. Levels 1–4 are today's thresholds: Explorer 300, Tastemaker 1000, Connoisseur 1500, Local Legend 2500. Verified-visit XP stays `XP_PER_VERIFIED_VISIT` (100). After 2500 XP, each new level costs 1000 XP (10 verified visits), with no cap. Level 5 is The Local Legend II at 3500 XP. Level 6 is The Local Legend III at 4500 XP. Naming and step size are provisional and will be revisited. Both live on `PROGRESSION_SCHEDULE_V1`.

`levelForXp(xp, schedule)` works for any explicit level count. Under v1, `nextLevel` is never null. A schedule with `continuingStepXp` of 0 or less still caps at its last explicit level. `levelFromXp(2500)` is unchanged: `nextLevel` is null and progress is 100%.

## Milestones

`milestonesFromVerifiedVisits({ verifiedAtAsc, schedule })` returns one entry per level the visits have already reached, in level order:

- `reachedAt` is the original timestamp string of the visit whose running XP first met `minXp`. Running XP is 100 times the count of valid timestamps up to and including that visit.
- `quarterKey` is the America/Chicago calendar quarter of that instant, such as `2026-Q4`. It uses the event time, not the time the helper runs.
- `milestoneKey` is `${scheduleVersion}:level:${level}`, for example `v1:level:5`.

No verified visits, or none that reach 300 XP, returns an empty list. The helper does not invent a `reachedAt`.

A timestamp is valid when `Date.parse` returns a finite instant. Invalid timestamps are dropped and do not throw. Strings are not trimmed and are not rewritten. Valid instants are sorted ascending. Equal instants keep their input order, so a repeated timestamp still counts as its own visit. The same input returns the same milestones.

A make-up visit is a normal verified visit: if its timestamp is in the list, it counts the same way. This helper does not read correction rows, badges, or the database. Ordinary QR issuance, recipes, activity checkmarks, public reviews, and negative reviews are not inputs, so they award nothing here.

## Quarters

`chicagoQuarterKey` uses `Intl.DateTimeFormat` with `timeZone: 'America/Chicago'`, the same calendar as `chicagoCalendarDate`. Q1 is January–March, Q2 April–June, Q3 July–September, Q4 October–December. An instant at 2026-12-31 23:30 America/Chicago (`2027-01-01T05:30:00.000Z`) is `2026-Q4`. An instant at 2027-01-01 00:30 America/Chicago is `2027-Q1`.

## Ledger (E09-A2)

Migration `20261110152224_e09_a2_progression_ledger.sql` is in the repo and is not applied to hosted. `record_verified_visit_progress(uuid)` is the only writer. `verify_redemption` and `verify_redemption_and_settle` are unchanged. `database.types.ts` is unchanged. `user_badges` is unchanged.

`progression_events` stores one XP row per source. `source_kind` is `verified_visit`. `source_id` is `redemptions.id` and is not a foreign key. `occurred_at` is that redemption's `verified_at`. `xp` is 100. `schedule_version` is `v1`. Unique on `(source_kind, source_id)`.

`progression_milestones` stores one row per member per `milestone_key`. The key is `${scheduleVersion}:level:${level}`, for example `v1:level:1`. Unique on `(user_id, milestone_key)`. Levels follow schedule v1: 300, 1000, 1500, and 2500 XP, then +1000 XP per level. XP is the count of that member's v1 verified-visit events times 100. `reached_at` is the `occurred_at` of the event at position `minXp / 100` when events are ordered by `occurred_at`, then `id`. `quarter_key` is the America/Chicago calendar quarter of that instant (`YYYY-Qn`), the same boundary as `chicagoQuarterKey`. `source_event_id` points at that crossing event. Level names are not stored.

A milestone is inserted once. A later event, including one with an earlier `occurred_at`, does not change `reached_at`, `quarter_key`, or the drawing entry. The first time the visit count reaches the threshold, the crossing visit is chosen from the events stored then.

`progression_drawing_entries` stores one row per milestone. `milestone_id` is unique. `entry_source` is `level_milestone`. The check allows that one value; another source is a later migration, not a campaign foreign key. `quarter_key` is copied from the milestone.

`record_verified_visit_progress` is `security definer` with `search_path` pinned to `pg_catalog, public`. Only `service_role` can execute it. It takes a per-member advisory lock, inserts the event with `on conflict do nothing`, then inserts any missing milestone and one drawing entry for each milestone that insert created.

An unknown id, a status other than `verified`, a null `verified_at`, or a null `user_id` returns null and writes nothing. It does not raise. A verified row with no verified time has no event time to store, so it is treated the same as not verified. A second call for a verified visit returns jsonb keys `events`, `milestones`, and `entries` as empty arrays and does not change counts. Those keys hold only the rows that call inserted.

A make-up visit is a normal verified redemption once `status` is `verified` and `verified_at` is set. This function does not read visit-problem tables. A savings correction does not change `status` or `verified_at`, so it awards no XP here. Neither the make-up function nor the savings correction calls this function.

Row level security is enabled and not forced, so the function owner can write. A member can select only their own rows. `anon` has no privileges. `authenticated` cannot insert, update, delete, or execute the function.

Before a hosted apply, rollback is reverting this migration. After a hosted apply, roll forward by dropping the three tables and the function. Nothing reads them.

## Caller (E09-A3)

`progressionLedgerEnabled()` in `src/lib/progression/flag.ts` is true only when `E09_PROGRESSION_LEDGER_ENABLED` is exactly `true`. Unset, empty, and every other value stay off. Leave the flag unset. This change does not set it in Vercel or anywhere else.

`verifyRedemptionTokenForPartner` is the only caller. After exactly one claimed row, after badge awarding and any Boost confirmation, and only when the flag is on and `redemption.id` is present, it awaits `recordVerifiedVisitProgress` in `src/lib/progression/record-visit.ts`. That helper calls `record_verified_visit_progress` with the service-role client. The RPC is not in `database.types.ts`. The call uses a local argument type. `npm run types:db` is not part of this change.

The verify result keeps today's fields and values. The helper returns `{ status, counts }` and does not throw. `recorded` means this call's `events`, `milestones`, or `entries` contain at least one row. `replay` means all three arrays are empty, and nothing else happens. `skipped` means the function returned null. `error` means the call returned an error, threw, timed out, or returned malformed jsonb.

On `skipped` or `error`, partner verify logs `progression ledger record failed` once and reports that same static error. The log does not include the token, member id, email, or redemption id. Verify still returns success. A replay or a recorded visit is not logged. Verify failures, rejections, and lookups that do not claim a row do not call the function. That includes an already verified code, the wrong restaurant, an expired code, and a duplicate-issued integrity error.

The only production writer of `redemptions.status = 'verified'` is `verify_redemption`. `verify_redemption_and_settle` calls that function and does not set the status itself. The only application caller of either RPC is partner verify. E07-D2 opens a make-up challenge item and later links an issued or already verified code. It does not verify a redemption. A savings correction does not change `status` or `verified_at`. A make-up code is recorded only when a partner verifies it through this same path while the flag is on. Admin tools, the expire cron, and supply simulations do not call the ledger.

Unsetting `E09_PROGRESSION_LEDGER_ENABLED` stops every call. Revert this caller to remove the code. Rows already written stay unread. The A2 migration is still not applied to hosted.

## Not in this slice

No backfill, and no drawing campaign. Historic levels, and whether those levels get drawing entries, are not decided here. No change to `user_badges`, Journey, or `levelFromXp`. Revert the A1 helpers by reverting that change. Journey does not read these helpers.

## Campaigns (E09-B1)

Pure helpers in `src/lib/drawings/campaign.ts`. No migration, no UI, no flag, and no database read or write. Nothing in the app calls them yet. This does not claim E09, E07, or E02 acceptance.

`validateCampaignDraft` and `checkCampaignEdit` add each prize's quantity times `unitValueCents` to `fulfillmentAllowanceCents`. That sum is `committedCents`. Amounts are integer cents. The sum may equal `totalBudgetCents`. Anything larger is `over_budget`. A valid current campaign does not allow the next draft to exceed its authorized total. Lowering `totalBudgetCents` below the cents still committed is rejected.

Sample mode requires every prize to have `isSample: true` and a label containing `Sample prize`. `displayPrizeLabel` starts sample labels with that marker. Live mode rejects an `isSample` prize. The only entry source is `level_milestone`. Reviews, QR issuance, and recipes are rejected. A public-review source is never eligible.

`campaignWindow` uses `chicagoQuarterKey` for the America/Chicago quarter, start inclusive and end exclusive. `2026-Q4` starts at 2026-10-01 00:00 America/Chicago and ends at 2027-01-01 00:00 America/Chicago, including the November DST change. These helpers do not set official rules or real prize values. Noah funds the drawings. No restaurant sponsorship is recorded here.

Revert the PR to roll the helpers back. Nothing in the app calls them yet.
