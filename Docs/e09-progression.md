# E09 continuing progression

A1 is pure helpers in `src/lib/progression/`. A2 adds the ledger migration and `record_verified_visit_progress`. A3 calls that function after a successful partner verify when `E09_PROGRESSION_LEDGER_ENABLED` is exactly `true`. A4 adds `backfill_verified_visit_progress` and a dry-run-first script. A2 is applied to hosted as `20261110182527`. A4 is applied to hosted as `20261110185755`. The hosted backfill ran on 2026-11-10 with `p_entries_from = '2027-01-01 00:00:00-06'` (1 event, 0 milestones, 0 entries; a rerun returned zeros). `E09_PROGRESSION_LEDGER_ENABLED` stays unset. A5 adds a read-only member progression read model. E09-B2 reads it on Progress only when `E09_MEMBER_PROGRESSION_UI_ENABLED` is exactly `true`. That flag ships unset, so Progress looks the same until then. No new migration. Journey's main level card still uses `levelFromXp` in `src/lib/progress/rules.ts`, which stops at The Local Legend. This does not claim E09, E07, or E02 acceptance.

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

Migration `20261110182527_e09_a2_progression_ledger.sql` is applied to hosted as `schema_migrations` version `20261110182527` (applied 2026-11-10). The previous repo filename was `20261110152224_e09_a2_progression_ledger.sql`. This rename applies nothing to hosted. `record_verified_visit_progress(uuid)` records one verified visit. `backfill_verified_visit_progress` is the other writer (E09-A4). `verify_redemption` and `verify_redemption_and_settle` are unchanged. `database.types.ts` is unchanged. `user_badges` is unchanged.

`progression_events` stores one XP row per source. `source_kind` is `verified_visit`. `source_id` is `redemptions.id` and is not a foreign key. `occurred_at` is that redemption's `verified_at`. `xp` is 100. `schedule_version` is `v1`. Unique on `(source_kind, source_id)`.

`progression_milestones` stores one row per member per `milestone_key`. The key is `${scheduleVersion}:level:${level}`, for example `v1:level:1`. Unique on `(user_id, milestone_key)`. Levels follow schedule v1: 300, 1000, 1500, and 2500 XP, then +1000 XP per level. XP is the count of that member's v1 verified-visit events times 100. `reached_at` is the `occurred_at` of the event at position `minXp / 100` when events are ordered by `occurred_at`, then `id`. `quarter_key` is the America/Chicago calendar quarter of that instant (`YYYY-Qn`), the same boundary as `chicagoQuarterKey`. `source_event_id` points at that crossing event. Level names are not stored.

A milestone is inserted once. A later event, including one with an earlier `occurred_at`, does not change `reached_at`, `quarter_key`, or the drawing entry. The first time the visit count reaches the threshold, the crossing visit is chosen from the events stored then.

`progression_drawing_entries` stores one row per milestone. `milestone_id` is unique. `entry_source` is `level_milestone`. The check allows that one value; another source is a later migration, not a campaign foreign key. `quarter_key` is copied from the milestone.

`record_verified_visit_progress` is `security definer` with `search_path` pinned to `pg_catalog, public`. Only `service_role` can execute it. It takes a per-member advisory lock, inserts the event with `on conflict do nothing`, then calls `progression_insert_missing_v1_milestones` and inserts one drawing entry for each milestone that call created. That helper is the only copy of schedule v1.

An unknown id, a status other than `verified`, a null `verified_at`, or a null `user_id` returns null and writes nothing. It does not raise. A verified row with no verified time has no event time to store, so it is treated the same as not verified. A second call for a verified visit returns jsonb keys `events`, `milestones`, and `entries` as empty arrays and does not change counts. Those keys hold only the rows that call inserted.

A make-up visit is a normal verified redemption once `status` is `verified` and `verified_at` is set. This function does not read visit-problem tables. A savings correction does not change `status` or `verified_at`, so it awards no XP here. Neither the make-up function nor the savings correction calls this function.

Row level security is enabled and not forced, so the function owner can write. A member can select only their own rows. `anon` has no privileges. `authenticated` cannot insert, update, delete, or execute the function.

A2 is applied to hosted as `20261110182527`. Roll forward by dropping the three tables and the function. A5 reads a member's own rows and does not write.

## Caller (E09-A3)

`progressionLedgerEnabled()` in `src/lib/progression/flag.ts` is true only when `E09_PROGRESSION_LEDGER_ENABLED` is exactly `true`. Unset, empty, and every other value stay off. Leave the flag unset. This change does not set it in Vercel or anywhere else.

`verifyRedemptionTokenForPartner` is the only caller. After exactly one claimed row, after badge awarding and any Boost confirmation, and only when the flag is on and `redemption.id` is present, it awaits `recordVerifiedVisitProgress` in `src/lib/progression/record-visit.ts`. That helper calls `record_verified_visit_progress` with the service-role client. The RPC is not in `database.types.ts`. The call uses a local argument type. `npm run types:db` is not part of this change.

The verify result keeps today's fields and values. The helper returns `{ status, counts }` and does not throw. `recorded` means this call's `events`, `milestones`, or `entries` contain at least one row. `replay` means all three arrays are empty, and nothing else happens. `skipped` means the function returned null. `error` means the call returned an error, threw, timed out, or returned malformed jsonb.

On `skipped` or `error`, partner verify logs `progression ledger record failed` once and reports that same static error. The log does not include the token, member id, email, or redemption id. Verify still returns success. A replay or a recorded visit is not logged. Verify failures, rejections, and lookups that do not claim a row do not call the function. That includes an already verified code, the wrong restaurant, an expired code, and a duplicate-issued integrity error.

The only production writer of `redemptions.status = 'verified'` is `verify_redemption`. `verify_redemption_and_settle` calls that function and does not set the status itself. The only application caller of either RPC is partner verify. E07-D2 opens a make-up challenge item and later links an issued or already verified code. It does not verify a redemption. A savings correction does not change `status` or `verified_at`. A make-up code is recorded only when a partner verifies it through this same path while the flag is on. Admin tools, the expire cron, and supply simulations do not call the ledger.

Unsetting `E09_PROGRESSION_LEDGER_ENABLED` stops every call. Revert this caller to remove the code. Rows already written stay in the tables. A5 can read them. A2 is applied to hosted as `20261110182527`. `E09_PROGRESSION_LEDGER_ENABLED` stays unset.

## Backfill and recovery (E09-A4)

Migration `20261110185755_e09_a4_progression_backfill.sql` is applied to hosted as `schema_migrations` version `20261110185755`. The previous repo filename was `20261110183232_e09_a4_progression_backfill.sql`. This rename applies nothing to hosted. It does not edit `20261110182527_e09_a2_progression_ledger.sql`. `backfill_verified_visit_progress(p_entries_from timestamptz, p_user_id uuid default null, p_dry_run boolean default true)` is `security definer` with `search_path` pinned to `pg_catalog, public`. Only `service_role` can execute it. `anon` and `authenticated` cannot. It does not change policies or grants on the three ledger tables.

`p_entries_from` is required. Null raises `p_entries_from is required` and writes nothing. There is no default in the function or in the script. Noah's chosen drawing-entry start is America/Chicago midnight on 2027-01-01, `2027-01-01 00:00:00-06`. Pass that instant when that is the decision. The code does not assume it. The hosted backfill ran on 2026-11-10 as a direct SQL call with `p_entries_from = '2027-01-01 00:00:00-06'` (America/Chicago midnight): 1 event, 0 milestones, 0 entries. A rerun returned zeros. `E09_PROGRESSION_LEDGER_ENABLED` stays unset.

The function takes the same per-member advisory lock as `record_verified_visit_progress` (`wanderbite.progression.v1` plus the member id). For each member, or for `p_user_id` when it is set, it inserts one event for every redemption with status `verified`, a non-null `verified_at`, and a non-null `user_id`. `on conflict do nothing` keeps a second run from writing that event again. Issued rows, expired rows, verified rows with a null `verified_at`, and rows with a null `user_id` are skipped. It then calls `progression_insert_missing_v1_milestones`. That helper is the only schedule: 300, 1000, 1500, and 2500 XP, then +1000 XP per level. A milestone already stored is not updated, so an earlier missed visit does not move `reached_at`, `quarter_key`, or the drawing entry.

A drawing entry is inserted only for a milestone this call created whose `reached_at` is on or after `p_entries_from`. A milestone at that exact instant gets an entry. An earlier milestone is stored and counted in `milestones_without_entry`. The return value is counts only: `members`, `events`, `milestones`, `entries`, `milestones_without_entry`. `members` counts members who received a new event or a new milestone. A second call with the same input returns zeros.

`p_dry_run` defaults to true. A dry run uses the same inserts to compute the counts, then undoes them. Passing false writes. Null is treated as a dry run.

Running it again later is the recovery sweep for a verified visit whose inline `record_verified_visit_progress` call failed. That sweep adds the missing event. A milestone created by the sweep gets one entry when its `reached_at` is on or after the same start instant.

Backfill must run before `E09_PROGRESSION_LEDGER_ENABLED` is turned on. If the flag is on first, a member's first ledger event can be a recent visit, and the milestone stays stamped on that visit. This change does not set the flag. The A3 caller is unchanged.

`npm run progression:backfill` parses `--entries-from YYYY-MM-DD` with `chicagoDateMidnight`, which uses `chicagoMidnight`. The script prints counts only. It does not print emails, member ids, or tokens. It refuses a hosted URL. There is no override. `--user-id` limits the run to one member. Omit `--apply` and it is a dry run.

Local ops order follows. The hosted backfill already ran on 2026-11-10. This rename does not run it again.

1. Do not `supabase db push` A2 or A4 from this change. A2 is on hosted as `20261110182527`. A4 is on hosted as `20261110185755`. These renames apply nothing to hosted.
2. On a local database, apply both migrations before the script. The script does not apply them.
3. Dry run. Noah's start date, when that is the one you mean: `npm run progression:backfill -- --entries-from 2027-01-01`
4. Write: `npm run progression:backfill -- --entries-from 2027-01-01 --apply`
5. Leave `E09_PROGRESSION_LEDGER_ENABLED` unset.
6. A later run with the same `--entries-from` is the recovery sweep. Nothing missing returns zeros.

A4 is applied to hosted as `20261110185755`. Roll forward by dropping `backfill_verified_visit_progress(timestamptz, uuid, boolean)`. Leave `progression_insert_missing_v1_milestones(uuid)` and the replaced `record_verified_visit_progress`. Recording still calls the helper. Rows already written stay in the A2 tables. A5 reads them and does not write. Delete by member if a row has to go. This does not claim E09, E07, or E02 acceptance.

## Not in this slice

No drawing campaign tables. A level reached before the operator-supplied start date gets no drawing entry. No change to `user_badges`, Journey, or `levelFromXp`. No change to the A3 caller. Revert the A1 helpers by reverting that change. Journey does not read these helpers.

## Campaigns (E09-B1)

Pure helpers in `src/lib/drawings/campaign.ts`. No migration, no UI, no flag, and no database read or write. Nothing in the app calls them yet. This does not claim E09, E07, or E02 acceptance.

`validateCampaignDraft` and `checkCampaignEdit` add each prize's quantity times `unitValueCents` to `fulfillmentAllowanceCents`. That sum is `committedCents`. Amounts are integer cents. The sum may equal `totalBudgetCents`. Anything larger is `over_budget`. A valid current campaign does not allow the next draft to exceed its authorized total. Lowering `totalBudgetCents` below the cents still committed is rejected.

Sample mode requires every prize to have `isSample: true` and a label containing `Sample prize`. `displayPrizeLabel` starts sample labels with that marker. Live mode rejects an `isSample` prize. The only entry source is `level_milestone`. Reviews, QR issuance, and recipes are rejected. A public-review source is never eligible.

`campaignWindow` uses `chicagoQuarterKey` for the America/Chicago quarter, start inclusive and end exclusive. `2026-Q4` starts at 2026-10-01 00:00 America/Chicago and ends at 2027-01-01 00:00 America/Chicago, including the November DST change. These helpers do not set official rules or real prize values. Noah funds the drawings. No restaurant sponsorship is recorded here.

Revert the PR to roll the helpers back. Nothing in the app calls them yet.

## Read model (E09-A5)

`summarizeMemberProgression` in `src/lib/progression/read-model.ts` turns one member's ledger rows into a summary. It does not read the database and it does not write. `loadMemberProgression` in `src/lib/progression/member-progression.ts` is the server-only loader. It takes the request-scoped Supabase server client from `src/lib/supabase/server`. It calls `auth.getUser()` and selects that member's rows from `progression_events`, `progression_milestones`, and `progression_drawing_entries`, with `user_id` set to the session user. RLS still applies. It does not import the service-role client. The three tables are not in `database.types.ts`. The loader uses a local row shape. `npm run types:db` is not part of this change.

E09-B2 is the only caller. It renders on Progress when `E09_MEMBER_PROGRESSION_UI_ENABLED` is exactly `true`, and it does not call the loader otherwise. `E09_PROGRESSION_LEDGER_ENABLED` stays unset. This slice adds no migration. No session returns `signed_out` and does not query. A failed read returns `unavailable`. More than 100,000 rows in one of the three tables also returns `unavailable`, so a partial page is not reported as the member's total.

XP is the count of events whose `schedule_version` is `v1` and whose `source_kind` is `verified_visit`, times 100. The visit count is that same count. Level, name, next level, and progress come from `levelForXp(xp, PROGRESSION_SCHEDULE_V1)`. Under v1, 3600 XP is level 5, The Local Legend II, and the next level is 6, The Local Legend III, at 4500 XP. Stored milestones are listed in level order. The name comes from the schedule. `reachedAt` and `quarterKey` are the stored values. They are not recomputed, including a milestone reached at 2026-12-31 23:30 America/Chicago and stored as `2026-Q4`. `hasEntry` is true only when a `level_milestone` drawing entry points at that milestone. Drawing entries are counted by their stored `quarter_key`.

A member with no rows gets xp 0, level 0, next level The Explorer at 300 XP, and empty milestones and entries. That does not throw.

`consistent` is false when the v1 milestone keys stored for the member differ from the keys `levelForXp` expects for that XP. A missing milestone is the usual case. The summary still lists the stored milestones and writes nothing. An unknown milestone key, or a `schedule_version` other than `v1`, is left out of the totals and counted on `ignored` (`events`, `milestones`, and `entries`). A duplicate milestone key is counted there too.

`supabase/tests/e09-a2-progression-ledger.sql` already checks that member A cannot read member B's events, milestones, or entries, and that `anon` cannot read any of the three tables. This slice does not add another RLS test.

Revert this PR to roll it back. No schema, no data, and no caller. This does not claim E09, E07, or E02 acceptance.

## Member panel (E09-B2)

`memberProgressionUiEnabled()` in `src/lib/progression/flag.ts` is true only when `E09_MEMBER_PROGRESSION_UI_ENABLED` is exactly `true`. Unset, empty, and every other value stay off. Leave the flag unset. This change does not set it in Vercel or anywhere else. `E09_PROGRESSION_LEDGER_ENABLED` stays unset and is a different flag.

`JourneyContent` renders the panel on the Progress view (`/journey`, view `journey`) only when the UI flag is on. The check happens before any ledger read. It then calls `loadMemberProgression` with `createClient` from `src/lib/supabase/server`. The flag off does not call the loader. `signed_out` renders nothing extra. `unavailable`, or a thrown read, shows "Couldn't load your levels right now" and the rest of Progress still renders. The thrown error is not logged.

The panel shows the summary as stored. Level, name, XP, next level, and progress come from that summary. Under v1, 3600 XP is The Local Legend II, and the next level is The Local Legend III at 4500 XP. Milestones stay in the summary's level order. The reached date is the America/Chicago calendar date of the stored `reachedAt`. The quarter label comes from the stored `quarterKey`. It is not computed again from the timestamp. `2026-Q4` is shown as Oct–Dec 2026. A milestone at `2027-01-01T05:30:00Z` stored as `2026-Q4` shows Dec 31, 2026 and Oct–Dec 2026.

`hasEntry` shows "Drawing entry". A milestone without an entry, reached before 2027-01-01 00:00 America/Chicago, shows "No drawing entry (before entries began)". That instant is `2027-01-01T06:00:00.000Z`, the same instant as `chicagoDateMidnight('2027-01-01')`. A later milestone without an entry has no marker. Entry counts use each row's stored `quarter_key`. The note is "Drawing entries count from Jan 1, 2027." The panel does not name a prize, a prize value, a live drawing, or a drawing date. Reviews, QR issuance, recipes, and activity checkmarks are not described as earning entries.

No ledger rows show level 0, next level The Explorer at 300 XP, and "You have not reached a level yet." That is not an error.

`consistent: false` still shows the stored milestones. The panel does not show `consistent` or `ignored`. It does not log a member id, email, or token.

The main Journey level card and `levelFromXp` are unchanged. Continuing levels appear only in this panel.

Rollback is unsetting `E09_MEMBER_PROGRESSION_UI_ENABLED`, or reverting this PR. No schema and no data. This does not claim E09, E07, or E02 acceptance.
