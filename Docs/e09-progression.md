# E09 continuing progression

A1 is pure helpers in `src/lib/progression/`. A2 adds the ledger migration and `record_verified_visit_progress`. A3 calls that function after a successful partner verify when `E09_PROGRESSION_LEDGER_ENABLED` is exactly `true`. A4 adds `backfill_verified_visit_progress` and a dry-run-first script. A2 is applied to hosted as `20261110182527`. A4 is applied to hosted as `20261110185755`. The hosted backfill ran on 2026-11-10 with `p_entries_from = '2027-01-01 00:00:00-06'` (1 event, 0 milestones, 0 entries; a rerun returned zeros). `E09_PROGRESSION_LEDGER_ENABLED` stays unset. A5 adds a read-only member progression read model. E09-B2 reads it on Progress only when `E09_MEMBER_PROGRESSION_UI_ENABLED` is exactly `true`. That flag ships unset, so Progress looks the same until then. The panel adds no migration. B3 stores sample and live drawing campaigns. That migration is not applied to hosted. E09-B7 reads those tables on `/admin/drawings` only when `E09_DRAWINGS_ADMIN_ENABLED` is exactly `true`, and that flag ships unset. E09-B8 adds activate, close, and simulated selection on that page only when `E09_DRAWINGS_ADMIN_ACTIONS_ENABLED` is also exactly `true`. That flag ships unset. E09-B8a hides the simulated-selection button when a closed sample campaign was not activated, says that Close can't be undone, and maps a campaign setup-check failure to its own message. Both flags still ship unset. E09-B9 adds sample fulfillment buttons (create records, mark ready, mark fulfilled with a cost, forfeit) only when `E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED` is also exactly `true`. That flag ships unset. A cost that would put recorded cost above the fulfillment allowance warns and asks for a second click. A deleted member's prize can be forfeited and cannot be marked ready or fulfilled. Journey's main level card still uses `levelFromXp` in `src/lib/progress/rules.ts`, which stops at The Local Legend. This does not claim E09, E07, or E02 acceptance.

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

Drawing campaign tables are E09-B3. Nothing in this slice reads them. A level reached before the operator-supplied start date gets no drawing entry. No change to `user_badges`, Journey, or `levelFromXp`. No change to the A3 caller. Revert the A1 helpers by reverting that change. Journey does not read these helpers.

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

## Campaign storage (E09-B3)

Migration `20261110214500_e09_b3_drawing_campaigns.sql` is not applied to hosted. Do not run `supabase db push` for this file. `drawing_campaigns` and `drawing_campaign_prizes` store one quarterly drawing configuration. `save_drawing_campaign(jsonb)` writes the campaign and its prizes in one transaction. Deferred constraint triggers call `drawing_campaign_reject` before commit, so a direct SQL write is held to the same rules as `validateCampaignDraft`. Nothing in the app calls the store. `database.types.ts` is unchanged. `E09_PROGRESSION_LEDGER_ENABLED` and `E09_MEMBER_PROGRESSION_UI_ENABLED` stay unset. This does not claim E09, E07, or E02 acceptance.

Committed cents are the sum of each prize's quantity times `unit_value_cents`, plus `fulfillment_allowance_cents`. Amounts are integer cents. The sum may equal `total_budget_cents`. Anything larger is `over_budget`, and the transaction writes nothing. Lowering the budget or raising a prize quantity past that sum is rejected, and the stored row stays as it was.

Sample mode requires every prize to have `is_sample` true and a label containing `Sample prize`. Live mode requires a non-empty `rules_version` and rejects an `is_sample` prize. The only entry source is `level_milestone`. `public_review`, `qr_issued`, and `recipe` are rejected. A public-review source is never eligible.

`starts_at` and `ends_at` are the America/Chicago quarter of `quarter_key`, start inclusive and end exclusive, the same instants as `campaignWindow`. `2027-Q1` starts at 2027-01-01 06:00:00Z and ends at 2027-04-01 05:00:00Z. `2026-Q4` starts at 2026-10-01 05:00:00Z and ends at 2027-01-01 06:00:00Z, including the November DST change. A window that does not match the quarter key is `invalid_quarter_key`.

Status is `draft`, `active`, or `closed`. A new row from the store is `draft`. At most one row per `quarter_key` has a status other than `closed`. A closed row does not block another quarter row. Storing a live campaign does not show it to members and does not select winners. Drawing entries are not linked to a campaign here.

Row level security is enabled. There are no policies for `anon` or `authenticated`. `service_role` can select, insert, update, and delete. `save_drawing_campaign` is granted to `service_role` only.

`createCampaign`, `updateCampaign`, and `getCampaign` live in `src/lib/drawings/campaign-store.ts`. Create runs `validateCampaignDraft`. Update runs `checkCampaignEdit`. Both call the database only after those checks pass. The store uses the service-role client. The read model, the member panel, the ledger flag, and the A3 caller are unchanged.

Revert the PR to roll this back. Locally, a later forward migration can drop the two tables, the triggers, and `save_drawing_campaign`. Nothing is on hosted, and nothing reads the tables.

## Campaign lifecycle (E09-B4)

Migration `20261110220339_e09_b4_drawing_campaign_lifecycle.sql` is not applied to hosted. Do not run `supabase db push` for this file. It does not edit `20261110214500_e09_b3_drawing_campaigns.sql`. `transition_drawing_campaign(uuid, text)` is the service-role writer for status. It locks the campaign row and allows only draft → active, active → closed, and draft → closed. A direct draft → closed update may commit. A direct draft → active, active → closed, active → draft, or closed → anything is rejected with `invalid_transition` when the deferred constraint `drawing_campaigns_transition` runs, which is at commit. The RPC sets that constraint immediate before it returns, so a bad transition fails inside the call. `database.types.ts` is unchanged. Nothing in the app calls this. `E09_PROGRESSION_LEDGER_ENABLED` and `E09_MEMBER_PROGRESSION_UI_ENABLED` stay unset. This does not claim E09, E07, or E02 acceptance.

Activation requires mode `sample`, `now()` strictly before `ends_at`, at least one prize, and committed cents at or under `total_budget_cents`. The budget check calls `drawing_campaign_reject`. `now()` equal to `ends_at` is `campaign_window_ended`. Zero prizes is `no_prizes`. A live draft is `live_activation_blocked`. That draft can still be edited and saved. A later migration can allow live activation. Official rules text is still not stored here.

`activated_at` is set when a draft becomes active and stays set after close. `closed_at` is set when the RPC closes a campaign. A direct draft → closed update does not stamp `closed_at`. Both columns are nullable `timestamptz`.

Once the stored status is active or closed, `save_drawing_campaign` and direct SQL reject changes to `quarter_key`, `mode`, `rules_version`, `total_budget_cents`, `fulfillment_allowance_cents`, `eligible_entry_sources`, `starts_at`, `ends_at`, and any prize insert, update, or delete. The code is `campaign_locked`. The stored campaign and prizes stay as they were. Deleting the campaign row is rejected the same way. A missing id is `not_found`.

The partial unique index `drawing_campaigns_one_open_quarter_idx` still allows one non-closed row per `quarter_key`. A second open row is `quarter_campaign_open` (SQLSTATE 23505, and the message names that index). `anon` and `authenticated` cannot execute the transition or write either table. `service_role` can.

`checkCampaignTransition` in `src/lib/drawings/campaign.ts` returns those same codes. `activateCampaign` and `closeCampaign` in `src/lib/drawings/campaign-store.ts` run it before the RPC. `updateCampaign` returns `campaign_locked` for an active or closed row and does not call the database. Draft budget, sample, live, and window checks are unchanged.

Revert this PR to roll it back. Locally, a later forward migration drops `transition_drawing_campaign`, the lock trigger, and the transition constraint, and restores B3's `save_drawing_campaign`. Nothing is on hosted, and nothing in the app reads the tables.

## Simulated selection (E09-B5)

Migration `20261110233322_e09_b5_drawing_selection.sql` is not applied to hosted. Do not run `supabase db push` for this file. It does not edit `20261110214500_e09_b3_drawing_campaigns.sql` or `20261110220339_e09_b4_drawing_campaign_lifecycle.sql`. `select_drawing_winners(uuid, text, text)` is the service-role writer for one simulated draw. The third argument defaults to null and generates the seed. A caller may pass 64 lowercase hex characters instead. That path is for tests. The store does not pass it. The function is still service-role only. `database.types.ts` is unchanged. Nothing in the app calls this. No email, push, or in-app notice is sent. `E09_PROGRESSION_LEDGER_ENABLED` and `E09_MEMBER_PROGRESSION_UI_ENABLED` stay unset. This does not claim E09, E07, or E02 acceptance.

The draw runs only for a closed sample campaign that was activated and then closed, so both `activated_at` and `closed_at` are set. The checks run in this order: `not_found`, `live_selection_blocked` (mode `live`, including a live draft), `campaign_not_closed` (any other status, a null `activated_at`, or a null `closed_at`), `already_selected`, `invalid_run_by`, `invalid_seed`, `no_eligible_entries`. `no_eligible_entries` writes nothing. A direct draft → closed leaves `closed_at` null and is `campaign_not_closed`. Closing a draft through the transition stamps `closed_at` and still leaves `activated_at` null, so that is `campaign_not_closed` too.

Eligible entries are `progression_drawing_entries` rows whose `quarter_key` equals the campaign quarter, whose `entry_source` is in `eligible_entry_sources`, and whose milestone `reached_at` is strictly before `closed_at`. Entries are not given a campaign foreign key. The order is the lowercase hex SHA-256 of the UTF-8 bytes of `seed || entry_id::text`, then the entry id. Prize units run in `position` order, then prize id, then `unit_index` from 1 through `quantity`. A member who already received a unit is skipped. `rank` is that entry's 1-based place in the eligible order. Units left when members run out are `unfilled_unit_count`. One campaign has one `drawing_selections` row. `simulated` is checked true. `run_by` is the trimmed operator label, not a user id.

`eligible_entry_ids` stores those entry ids in that sha256-rank order, including entries that did not win. `eligible_user_ids` stores the member of each of those entries in the same order. The two arrays have the same length as `eligible_entry_count`. The ids are what a later check replays into prize assignment, and the member ids are what the one-prize-per-member skip needs. The row stays append-only. Grants are unchanged: `service_role` can select, the function is `service_role` execute only, and `anon` and `authenticated` have nothing.

`src/lib/drawings/selection.ts` repeats that order in `selectWinners` and the same gate codes in `checkSelectionAllowed`. `runSimulatedSelection` runs the gate, then the function. `verifySelection` first replays `selectWinners` from the stored seed and the stored entry and member ids. `match` is that replay against the stored winners. It then loads the entries that are eligible now, in pages of 1000 and milestone id chunks of 200, and sets `drift` when that current pool's ranked ids differ from `eligible_entry_ids`. Drift does not by itself make `match` false. Removing an entry after the draw leaves the winners in place, keeps `match` true, and sets `drift` true.

The selection tables are append-only. UPDATE and DELETE raise `selection_immutable`. A direct INSERT raises the same code unless the transaction set `wanderbite.drawing_selection` to the campaign id, which the function does for its own writes. Row level security is on. There are no policies. `anon` and `authenticated` have no grants. `service_role` can select and can execute the function. It cannot insert, update, or delete the tables.

Deleting a member cascades their milestones and drawing entries. Winner rows copy `user_id` and `entry_id` and do not reference those tables, so the audit row stays and the ids may no longer point at a profile or an entry. A foreign key would either erase the audit or, with the immutability trigger, block the member delete. What to do with those leftover rows is decided in E09-B9: they stay, the admin page labels the member "Deleted member", and an admin can forfeit that prize. This slice does not redraw, replace a winner, or record fulfillment.

Revert this PR to roll it back. Locally, a later forward migration drops `select_drawing_winners(uuid, text, text)` and the two selection tables. Nothing is on hosted, and nothing in the app reads them.

## Sample fulfillment (E09-B6)

Migration `20261111010700_e09_b6_drawing_fulfillment.sql` is not applied to hosted. Do not run `supabase db push` for this file. It does not edit `20261110214500_e09_b3_drawing_campaigns.sql`, `20261110220339_e09_b4_drawing_campaign_lifecycle.sql`, or `20261110233322_e09_b5_drawing_selection.sql`. `create_drawing_fulfillments(uuid, text)` inserts one fulfillment per winner of a simulated selection. `transition_drawing_fulfillment(uuid, text, text, text, integer)` moves one row. `database.types.ts` is unchanged. Nothing in the app calls this. No email, push, or in-app notice is sent, and nothing ships. `E09_PROGRESSION_LEDGER_ENABLED` and `E09_MEMBER_PROGRESSION_UI_ENABLED` stay unset. This does not claim E09, E07, or E02 acceptance.

`drawing_fulfillments` has one row per `drawing_selection_winners` row (`winner_id` is unique). It copies `selection_id`, `campaign_id`, and `prize_id`. `simulated` is checked true. Status is `pending`, `ready`, `fulfilled`, or `forfeited`. `create_drawing_fulfillments` writes every winner of the selection as `pending`, plus one creation event (`from_status` null, `to_status` `pending`). A second call inserts nothing and returns the same rows. A missing selection is `not_found`. A blank operator label is `invalid_run_by`, and that is checked after `not_found`. The label is trimmed and stored as the event's `actor`. It is not a user id.

The only moves are pending → ready, pending → forfeited, ready → fulfilled, and ready → forfeited. `fulfilled` and `forfeited` are final. pending → fulfilled is `invalid_transition`. Forfeit does not insert a winner, a selection, or another fulfillment, and it does not redraw. The transition locks the row `FOR UPDATE`. Two sessions moving the same row produce one change. The loser gets `invalid_transition`.

A move to `fulfilled` requires `actual_cost_cents`. 0 is allowed and is stored. A missing cost is `cost_required`. A cost on any other move is `cost_not_allowed`, including 0 and a negative number, because the edge is rejected before the write. A negative cost on the move to `fulfilled` fails `drawing_fulfillments_actual_cost_cents_check` (SQLSTATE 23514) and changes nothing. A note is optional, trimmed, and at most 500 characters. Longer than that fails `drawing_fulfillment_events_note_check` and changes nothing. Each accepted move writes the status and one `drawing_fulfillment_events` row in the same transaction. The event stores `from_status`, `to_status`, the trimmed actor, the trimmed note, and the cost (null except on `fulfilled`).

`fulfillment_allowance_cents` on the campaign is the reserved fulfillment budget from E09-B1. Committed cents are each prize's quantity times `unit_value_cents`, plus that allowance, and that sum must stay at or under `total_budget_cents`. This slice stores `actual_cost_cents` on the fulfilled row and sums those values in `summarizeFulfillment`. It does not compare the sum to `fulfillment_allowance_cents` or to `total_budget_cents`. Noah decided on 2026-11-12 that a recorded cost may go above `fulfillment_allowance_cents`. E09-B9 warns and asks for a second click. There is no database cap. This slice still only stores and reports the cost.

Direct INSERT or UPDATE on `drawing_fulfillments` raises `fulfillment_immutable` unless the transaction set `wanderbite.drawing_fulfillment` to the selection id. The two functions set that for their own writes and clear it before they return. DELETE on `drawing_fulfillments` always raises `fulfillment_immutable`, including while that setting is held. Identity columns cannot change. UPDATE or DELETE on `drawing_fulfillment_events` raises `fulfillment_event_immutable`. A direct INSERT on the event table raises the same code unless the setting names the parent fulfillment's selection. Row level security is on. There are no policies. `anon` and `authenticated` have no grants. `service_role` can select both tables and can execute the two functions. It cannot insert, update, or delete.

Deleting a member cascades milestones and drawing entries. Winner rows keep a copied `user_id` and `entry_id` with no foreign key, so they stay. Fulfillment rows reference the winner, not the member, so they stay too. The ids on the winner may no longer point at a profile or an entry. Noah decided on 2026-11-12 that those rows stay. E09-B9 labels the member "Deleted member" and lets an admin forfeit that prize. This slice does not delete the rows and does not block the member delete.

`checkFulfillmentTransition` in `src/lib/drawings/fulfillment.ts` returns the same edge and cost codes, including the two check names. `summarizeFulfillment` counts rows by status and sums `actualCostCents` for prizes in the list passed in. It does not add `unitValueCents`. `createFulfillments`, `transitionFulfillment`, and `listFulfillments` live in `src/lib/drawings/fulfillment-store.ts`. Create and transition run the pure checks before the RPC. List reads one campaign in pages of 1000 and orders the loaded rows by the `created_at` instant, then id. The read model, the member panel, the ledger flag, the selection algorithm, and the A3 caller are unchanged.

Revert the PR to roll this back. Locally, a later forward migration drops `create_drawing_fulfillments(uuid, text)`, `transition_drawing_fulfillment(uuid, text, text, text, integer)`, and the two fulfillment tables. Nothing is on hosted. E09-B7 is the first read of these rows, and only when its flag is on.

## Admin drawings view (E09-B7)

`/admin/drawings` lists stored drawing campaigns. It renders only when `E09_DRAWINGS_ADMIN_ENABLED` is exactly `true`. The flag ships unset. Any other value, including empty, calls `notFound()` before the admin guard and does not query a drawing table. With the flag off, middleware returns that path without a session lookup, and the page 404s. With the flag on, a signed-out visitor is redirected to sign-in the same way as the other admin pages. A signed-in member is sent to `/challenges`. An admin who has not passed the authenticator gate sees that gate. Those paths do not query a drawing table.

After the guard, the page reads with the service-role client on the server. `getCampaign` does not list campaigns and does not return `activated_at` or `closed_at`, so this slice lists those columns itself. Prizes use `displayPrizeLabel`. Committed cents are each prize's quantity times `unit_value_cents`, plus `fulfillment_allowance_cents`, shown in dollars next to the authorized total. A simulated selection shows a truncated seed, the eligible entry count, the unfilled unit count, `run_by`, and the run date. Winners are in rank order with the prize label, the first eight characters of the member id, and "Deleted member" when `user_profiles` has no row. Fulfillment counts are pending, ready, fulfilled, and forfeited. The recorded cost is the sum of `actual_cost_cents` next to the allowance. When that sum is greater than the allowance, the page shows "Recorded cost is above the fulfillment allowance" as a note. It does not block, and it does not change a row. Dates are America/Chicago calendar dates. `2027-01-01T05:30:00Z` is Dec 31, 2026.

The page does not show member emails, full user ids, or the full seed. It has no control that writes. It does not run a selection, create or move a fulfillment, or contact a member. Members get no new nav item.

If the drawing tables are missing, the page shows "Drawing tables aren't set up on this database yet" and returns 200. A missing relation is Postgres `42P01` or PostgREST `PGRST205` (the schema-cache miss the Data API returns for a table that is not there). A missing column (`42703`, `PGRST204`) uses the same message so a partial schema does not throw. B3, B4, B5, and B6 are not applied to hosted. This page does not apply them. `database.types.ts` is unchanged.

Noah decided on 2026-11-12 that recorded cost may go above `fulfillment_allowance_cents`, with a warning and a second click in E09-B9 and no database cap, and that winner rows stay after a member is deleted. This page only displays them.

No migration. `E09_PROGRESSION_LEDGER_ENABLED` and `E09_MEMBER_PROGRESSION_UI_ENABLED` stay unset. `E09_DRAWINGS_ADMIN_ENABLED` ships unset. This does not claim E09, E07, or E02 acceptance.

Rollback is unsetting `E09_DRAWINGS_ADMIN_ENABLED`, or reverting this PR. No schema and no data.

## Admin drawing actions (E09-B8)

`/admin/drawings` can activate a sample draft, close a draft or an active campaign, and run one simulated selection. The buttons render only when `E09_DRAWINGS_ADMIN_ENABLED` and `E09_DRAWINGS_ADMIN_ACTIONS_ENABLED` are both exactly `true`. `E09_DRAWINGS_ADMIN_ACTIONS_ENABLED` ships unset. Any other value, or the read flag off, leaves the page as the E09-B7 read-only list: the same copy, no action button, and a direct call to any action returns `disabled` before `assertAdmin` and before a store or Supabase call.

With both flags on, the page still uses the E09-B7 guard. A signed-out visitor is redirected to sign-in. A signed-in member is sent to `/challenges`. An admin who has not passed the authenticator gate sees that gate. Those paths do not query a drawing table. Each server action calls `assertAdmin` in `src/lib/auth/assert-admin.ts` again, so a direct call is rejected for a signed-out user, a non-admin, or an admin who has not passed MFA, and the store is not called. `assertAdmin` checks the session, `user_profiles.role = 'admin'`, and authenticator assurance `currentLevel` `aal2`.

The buttons come from `drawingAdminActionOffers`. A sample draft offers Activate and Close. A live draft offers Close only, and the page says live campaigns can't go active until official rules exist. An active campaign offers Close. A closed sample campaign with no selection offers Run simulated selection only when both `activated_at` and `closed_at` are set. If either timestamp is missing, the page shows no button and the note "This campaign was closed without being activated, so it can't run a simulated selection." That covers a draft closed through `transition_drawing_campaign` (`closed_at` set, `activated_at` still null) and a direct draft → closed update (`closed_at` left null). A closed campaign that already has a selection, and any closed live campaign, still offer nothing. Each button takes a second click before the action runs. Activate confirms with "Yes, activate". Close on a draft confirms with "Yes, close without activating" and the note "Closing a draft can't be undone, and it will never run a simulated selection. A new draft for this quarter can still be saved later." Close on an active campaign confirms with "Yes, close" and "Closing can't be undone." Run simulated selection confirms with "Yes, run simulated selection". The first click does not call the server action. The result is shown on the page. A store error stays a plain message. The campaign row is not changed by the page when the store rejects the call.

E09-B8a is that tightening. With the actions flag off, or the read flag off, the page is the E09-B7 read-only list: no buttons and none of these notes. A direct action call still returns `disabled` before `assertAdmin` and before a store call. Presence of `activated_at` and `closed_at` comes from the raw timestamps, not the formatted America/Chicago dates. `2027-01-01T05:30:00Z` is still Dec 31, 2026.

Activate and close call `activateCampaign` and `closeCampaign`. Those run `checkCampaignTransition`, then `transition_drawing_campaign`. There is no new RPC and no new migration. A live draft returns `live_activation_blocked`. `now()` equal to `ends_at` is `campaign_window_ended`. The other transition codes (`invalid_transition`, `no_prizes`, `over_budget`, `not_found`) use the same plain-message map. When the store returns `{ errors }` that contain a campaign setup code and no store code, the action returns `campaign_invalid`: "This campaign's setup doesn't pass its checks, so its status can't change." A lone `over_budget` stays the budget message, because `transitionCampaign` rewrites that single code to `{ error: 'over_budget' }` and it is already a store code. A thrown error, a failed read, or a result with no recognized code stays "Drawing records are unavailable." Dates stay America/Chicago calendar dates. `2027-01-01T05:30:00Z` is Dec 31, 2026.

`drawing_campaign_reject` is the setup check. It raises every `CAMPAIGN_ERROR_CODE` in `src/lib/drawings/campaign.ts`, one at a time: `invalid_quarter_key`, `invalid_mode`, `invalid_rules_version`, `non_integer_cents`, `negative_cents`, `empty_prizes`, `invalid_label`, `non_integer_quantity`, `negative_quantity`, `zero_quantity`, `sample_prize_required`, `sample_label_required`, `live_sample_prize`, `unknown_entry_source`, `public_review_entry`, and `over_budget`. `transition_drawing_campaign` calls it explicitly only on draft → active, after the live, window, prize-count, and open-quarter checks. Close does not call it inside the function. The deferred constraint `drawing_campaigns_enforce` still runs it at commit on every status update, including close, because the RPC sets only `drawing_campaigns_transition` immediate. `failureFromDb` turns a raised campaign code into `{ errors: [code] }`. `transitionCampaign` then rewrites a lone `over_budget` to `{ error: 'over_budget' }`. Every other code in that list is mapped to `campaign_invalid` when it arrives on `errors` with no store code. `getCampaign` returns `unavailable` before the RPC when it cannot parse the row, including a mode other than `sample` or `live` and a non-integer cent or quantity value, so `invalid_mode`, `non_integer_cents`, and `non_integer_quantity` do not reach the RPC from an unreadable row. Activate's own pre-check returns `no_prizes` when the prize count is 0, which is a different code from `empty_prizes`. `checkCampaignTransition` returns `{ error }`, not `{ errors }`, for `invalid_transition`, `live_activation_blocked`, `campaign_window_ended`, `no_prizes`, and `over_budget`. A read failure is `{ error: 'not_found' }` or `{ error: 'unavailable' }`. A row saved through `save_drawing_campaign` already passed `drawing_campaign_reject` at that commit, so a later transition re-check fails only if the stored row would fail the same function again. This slice did not execute each raise in a database.

Run simulated selection calls `runSimulatedSelection`, which runs `checkSelectionAllowed` and then `select_drawing_winners`. `run_by` is `admin:` plus the first 8 characters of the admin user id, lowercased (for example `admin:aaaaaaaa`). The B5 check on `drawing_selections.run_by` is `btrim(run_by) <> ''`. There is no length cap. The column is an operator label, not an `auth.users` id. The action does not send the admin email or the full user id. One campaign stores one selection. A second call, including a double click or a second tab, returns `already_selected` and does not insert another row. The button is gone once the page reloads with a selection. No email, push, or in-app notice is sent.

Missing drawing tables still show "Drawing tables aren't set up on this database yet" and no buttons. B3, B4, B5, and B6 are not applied to hosted. This slice does not apply them. `database.types.ts` is unchanged.

The actions do not create, edit, or delete a campaign, create or move a fulfillment, or contact a member. The page still does not show member emails, full user ids, or the full seed. Noah decided on 2026-11-12 that summed fulfillment costs are not capped by `fulfillment_allowance_cents` (E09-B9 warns instead) and that winner and fulfillment rows stay after a member is deleted. Fulfillment buttons are not on this page.

No change to a migration, an RPC, the selection algorithm, progression tables or writers, the member panel, the A3 caller, verify RPCs, or any other flag. `E09_PROGRESSION_LEDGER_ENABLED` and `E09_MEMBER_PROGRESSION_UI_ENABLED` stay unset. This does not claim E09, E07, or E02 acceptance.

Rollback is unsetting `E09_DRAWINGS_ADMIN_ACTIONS_ENABLED`, or reverting this PR. Rows written while the flag was on stay. Selection rows are append-only. No schema change.

## Admin fulfillment actions (E09-B9)

`/admin/drawings` can create fulfillment records for a simulated selection and move each winner's record. The buttons render only when `E09_DRAWINGS_ADMIN_ENABLED`, `E09_DRAWINGS_ADMIN_ACTIONS_ENABLED`, and `E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED` are all exactly `true`. `E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED` ships unset. Any other value, or either existing drawing flag off, leaves the page as the E09-B8a page (or the E09-B7 read-only list when the actions flag is off): the same copy, no fulfillment button, and a direct call to either fulfillment action returns `disabled` before `assertAdmin` and before a fulfillment read or store call.

With all three flags on, the page still uses the E09-B7 guard. A signed-out visitor is redirected to sign-in. A signed-in member is sent to `/challenges`. An admin who has not passed the authenticator gate sees that gate. Those paths do not query a drawing table. Each fulfillment action calls `assertAdmin` again, so a direct call is rejected for a signed-out user, a non-admin, or an admin who has not passed MFA, and the store is not called. `assertAdmin` checks the session, `user_profiles.role = 'admin'`, and authenticator assurance `currentLevel` `aal2`.

The buttons come from `drawingFulfillmentOffers`. When the view has a selection id and no fulfillment row, it offers "Create fulfillment records", confirmed with "Yes, create records". The offer does not re-check mode or status. A simulated selection is stored only for a sample campaign that was activated and then closed, so that is the campaign this button appears on. That calls `createFulfillments` with the selection id and `run_by` `admin:` plus the first 8 characters of the admin user id, lowercased. A second call, including a double click or a second tab, returns the same rows. The function inserts nothing the second time. After the page reloads, every winner shows Pending. Pending offers Mark ready and Forfeit. Ready offers Mark fulfilled and Forfeit. Fulfilled and forfeited offer nothing. pending → fulfilled is not offered. A direct call returns `invalid_transition` and does not call `transitionFulfillment`. A bad edge wins over a bad cost, which is the same order as `checkFulfillmentTransition`.

Mark fulfilled asks for a dollar amount. Zero is allowed and is stored as 0. The server parses the dollar text to integer cents. Empty is `cost_required`. A negative amount, a non-numeric amount, or more than two decimal places is `invalid_cost`. Neither calls `transitionFulfillment`. The current status is read first, so pending → fulfilled stays `invalid_transition` even when the dollar text is also bad. A cost is not sent on a move to ready or forfeited. An optional note is at most 500 characters after trim. The client blocks a longer note, and the server rejects it before `transitionFulfillment`. The store code `drawing_fulfillment_events_note_check` maps to the same plain message. The first click on a button does not call the server.

Noah decided on 2026-11-12 that "budget" here is the campaign's `fulfillment_allowance_cents`, the same comparison E09-B7 uses for "Recorded cost is above the fulfillment allowance". Recorded cost is `summarizeFulfillment`'s total: the sum of `actual_cost_cents` on rows whose prize is on the campaign. It is not `total_budget_cents`. When recorded cost plus the new cost is above the allowance, the action returns `over_allowance_confirm` with the dollar amounts and does not call the store. The page then shows "Yes, record above allowance". That second click sends `confirmOverAllowance` true and the store records the cost. The row becomes Fulfilled, and the existing allowance note shows. Equal to the allowance is not a warning. There is no hard block and no database cost cap.

Noah decided the same day that a winner whose `user_profiles` row is gone keeps the prize record, labeled "Deleted member". Pending and ready for that winner offer Forfeit only. No prize is marked ready or fulfilled for a deleted account. Forfeit confirms with "Yes, forfeit" and "Forfeiting can't be undone and does not pick a new winner." The row becomes Forfeited. No winner, selection, or fulfillment is inserted, and no redraw happens. Mark fulfilled confirms with "Yes, mark fulfilled" and "Fulfilled can't be undone."

Missing drawing tables still show "Drawing tables aren't set up on this database yet" and no buttons. B3, B4, B5, and B6 are not applied to hosted. This slice does not apply them. `database.types.ts` is unchanged. The page does not show member emails, full user ids, or the full seed. No email, push, or in-app notice is sent. Nothing ships, and no prize is sent.

No change to a migration, an RPC, or the fulfillment store functions. The store header comment now names these actions as the callers of `createFulfillments` and `transitionFulfillment`. No change to the selection algorithm, campaign actions from E09-B8 or E09-B8a, progression tables or writers, the member panel, the A3 caller, verify RPCs, middleware, or any other flag. `E09_PROGRESSION_LEDGER_ENABLED` and `E09_MEMBER_PROGRESSION_UI_ENABLED` stay unset. This does not claim E09, E07, or E02 acceptance.

Rollback is leaving `E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED` unset, or reverting this PR. Fulfillment rows and events written while the flag was on stay. They are append-only. No schema change.
