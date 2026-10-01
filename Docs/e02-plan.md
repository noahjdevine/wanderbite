# E02 plan

Base `a47b90a`. **Master E02 is open. Master E04 is open.** Nothing below is a sign-off. “Landed” means the cited PR merged. Recommendations are marked **recommended, needs Noah**.

## 1. Draft criteria and the supply gate

### Draft master E02 criteria (for Noah to confirm)

This numbered list is a **draft**, taken only from merged PR bodies #42–#52 and `Docs/`. It is not the master list. [#43](https://github.com/noahjdevine/wanderbite/pull/43) is E03. [#49](https://github.com/noahjdevine/wanderbite/pull/49) only retargets the CI Postgres image.

1. Offer binding, pair floor `base_sum >= 2000` cents, 840-hour deadline, capacity. Landed. [#42](https://github.com/noahjdevine/wanderbite/pull/42). `supabase/tests/e02-capacity-binding.sql`.
2. Inactive ledger; `workflow_version` defaults to `legacy`. Landed. [#44](https://github.com/noahjdevine/wanderbite/pull/44). `supabase/tests/e02-b-credits.sql`.
3. Daily catch-up and shared last seat. Landed. [#45](https://github.com/noahjdevine/wanderbite/pull/45). `scripts/e02-remainder-catchup.ts`, `scripts/e02-remainder-shared-seat.ts`, `src/lib/challenges/issue-credit-catchup.test.ts`.
4. Rollover of older pending credits. Landed. [#46](https://github.com/noahjdevine/wanderbite/pull/46). `scripts/e02-rollover.ts`, `src/lib/challenges/rollover-credits.test.ts`.
5. `assign_carried_credit` (2000-cent floor for that function). Landed. [#47](https://github.com/noahjdevine/wanderbite/pull/47). `supabase/tests/e02-assign-carried-credit.sql`.
6. One linked-credit swap per America/Chicago month. Landed. [#48](https://github.com/noahjdevine/wanderbite/pull/48). `supabase/tests/e02-credit-safe-swaps.sql`.
7. Carried credits on `/challenges`. Landed. [#50](https://github.com/noahjdevine/wanderbite/pull/50). `src/lib/challenges/carried-credits.test.ts`, `src/lib/challenges/assign-carried-credit.test.ts`.
8. Cohort fixture printing `match 10/12`. Landed fixture only, not the gate. [#51](https://github.com/noahjdevine/wanderbite/pull/51). `supabase/tests/e02-six-month-cohort.sql`.
9. Supply simulation on synthetic configs. Landed; gate stays open. [#52](https://github.com/noahjdevine/wanderbite/pull/52). `src/lib/challenges/supply-simulation.test.ts`, `scripts/e02-supply-simulation.ts`.
10. `subYears(now, 12)` still in swap and variety. **Open.** [#52](https://github.com/noahjdevine/wanderbite/pull/52) follow-up. No test on `main` for those copies.
11. A real profile on `credits`. **Blocked.** Those PRs forbid the cutover. Hosted count in §2 is 0.
12. Master E02 acceptance and master E04 acceptance. **Open.** No master file in the repo.

**D1. Adopt this draft?** A) Noah pastes the original list and this draft is retired. B) Accept this draft as the master list. C) Keep it unofficial until a later confirmation. **Recommended, needs Noah: C.**

### Decision: six-month supply gate

[#51](https://github.com/noahjdevine/wanderbite/pull/51) says cohort `match 10/12` is not this gate. [#52](https://github.com/noahjdevine/wanderbite/pull/52) says the selector still does not close it.

**Metric.** `src/lib/challenges/supply-simulation.ts` line 747 counts credits with `challengeItemId !== null`; line 760 sets `denominator` to `ledger.credits.length`. `baseConfig` `ks` is `[5, 4, 3, 2, 1, 0]` (line 209); each `k` uses `chicagoMonthStart` (line 488) and `issueTwoCredits` (line 495). `COVERAGE_CONFIG` (line 219) keeps those six months. Do not use `seededMatchRate` (lines 841–849). `tight_ceiling` overrides `ks` to `[0]` (line 227).

**Catalog.** A) The 29 synthetic `SUPPLY_RESTAURANTS` (lines 116–135: 12 `S*` rows plus keys `U1` through `Far2`). B) A read-only snapshot of the 24 active hosted restaurants loaded into disposable Docker. No loader for B is in this file. C) Both.

**Threshold. Recommended, needs Noah:** catalog A, and pass only when `COVERAGE_CONFIG` has `numerator === denominator`. [#52](https://github.com/noahjdevine/wanderbite/pull/52) printed `simulated_match=12/12` for coverage. That print is not a pass of this gate. Master E04 stays open until Noah confirms.

**Run and record.** `npm test` (`src/lib/challenges/supply-simulation.test.ts`) and `npm run test:db` (`scripts/e02-supply-simulation.ts` via `scripts/test-database.ts`) print `simulated_match=` (`formatSupplySimulationReport`, line 940). Paste that line. No `db push`. B or C needs a loader that does not write hosted data.

**Determinism.** The simulation sorts with `byId` (line 360; lines 576 and 605). Production `generate.ts` shuffles with `randomInt` (lines 171–175) at line 527. A gate pass does not fix a member’s draw.

**D2. Gate score?** A) Catalog A, `numerator === denominator` on `COVERAGE_CONFIG`. B) Catalog B with a threshold Noah names. C) Both must pass. **Decided by Noah 2026-10-01: B, hosted active snapshot, threshold 100% of credits issued over 6 Chicago months, every seeded trial.**

### Supply gate (D2=B)

Catalog A (`SUPPLY_RESTAURANTS`, criterion 9) stays the logic regression. It is not this gate. The #51 SQL cohort is not this gate.

**Metric.** Denominator is 16 members × 6 Chicago months × 2 credits = 192. Numerator is those credits with `challengeItemId !== null` at the end of M5. A carry match counts in the numerator and is reported `matched_via_carry`. Do not use `seededMatchRate`. PASS only when numerator === denominator in every seeded trial. One unmatched credit is FAIL.

**Cohort.** `SUPPLY_GATE_COHORT`: 4 launch ZIPs (75069, 75070, 75071, 75072) × open/restricted × new/tenured. Open has no flags. Restricted uses `MEMBER_FLAGS` (vegan, peanut, italian) and counts toward 100% unless Noah later makes that persona report-only. Distance band `5_mi`, no cocktail reserve, no swaps, completion `verify_on_assign`. Tenured members get 6 unscored warm-up months (M−6..M−1, ks 11..6) on a private capacity table with offer-validity checks off. Warm-up seeds redemptions and cycles only.

**Window.** M0 is the first Chicago month whose simulated 15th 18:00Z is at or after the snapshot `exported_at`. Score M0..M5. Each month: `applyRollover` after the member’s first month, `issueTwoCredits`, carried assign (single base >= 2000), then a pair link.

**Trials.** Default 20, seeds 1..N, mulberry32 shuffle. `--seed` repeats one trial. Never `Math.random`.

**Funnel.** First failing rule at the radius actually used: outside_market, no_offer_version (legacy offers are diagnostic only; `legacy_offer_only`), offer_version_not_selectable (`offerVersionCoversDeadline`: not_yet_valid, expires_before_deadline, withdrawn), offer_tiers_invalid, missing_coordinates, dietary_exclusion, allergy, excluded_cuisine, cooldown_recent_visit_6m, cooldown_two_in_12m, capacity_full, variety_6m, variety_12m, relaxed_variety_last_month, outside_distance, pair_below_floor / carried_below_floor. Variety uses `varietyCycleMonthLowerBound(now, 6|12)` with `cycle_month >= bound` and `< chicagoMonthStart(now)`. Redemption cooldown stays rolling (`redemptionCooldownReason` / `redemptionCooldownOk`).

**Offer versions.** A restaurant is selectable only with a current offer version that passes the same window as `version_selection_ok` (`20260925175518`) and that `link_pending_credits` (`20260925215534`) requires. Legacy `restaurant_offers` do not make a restaurant eligible. Pair floor is lowest-tier `discount_cents` summed >= 2000, the same cents `offer_lowest_tier_cents` adds in `link_pending_credits`.

**Floor-aware selector.** No production caller of `link_pending_credits` exists under `src/` (the SQL function receives the pair; it does not choose it). This gate picks the first seeded `(i < j)` pair with base sum >= 2000 and capacity in both. The future credits selector must be floor-aware or this gate overstates supply.

**How Noah runs it.** In the Supabase SQL editor or another read-only session, run `scripts/sql/e02-supply-snapshot.sql` (`begin transaction read only`, one `select`, `rollback`). Save the single JSON cell to `.supply-gate/hosted-catalog.json` (gitignored). Then `npm run supply:gate`. Paste the summary lines only. Never paste or commit the snapshot. An agent or CI must not run that SQL against the hosted project.

**Checklist.** Six-month supply gate (D2=B): built in this PR; not yet run on the hosted snapshot; expected FAIL. Open. Master E02 is open. Master E04 is open. Criterion 11 stays blocked. This doc does not claim the gate passed.

## 2. Hosted state

`list_migrations` and `execute_sql` on project `yiajoycgiyxjvznndjge`, read-only. Tool: Supabase MCP. Run by Cursor cloud agent `bc-8275db30-2a45-5115-9608-c45600e30d95` (run owner Noah Devine). Completed 2026-10-01T14:31:35Z.

**Evidence.** `list_migrations` rows for these versions, names exactly: `20260925011529` / `e01_offer_versions`, `20260925175518` / `e02_capacity_binding`, `20260925215534` / `e02_b_credit_ledger`, `20260927220000` / `e02_rollover_credits`, `20260929180338` / `e02_assign_carried_credit`, `20260929201138` / `e02_credit_safe_swaps`.

```sql
select status, count(*)::int as n from public.restaurants group by status order by status;
-- active | 24

select workflow_version, subscription_status, count(*)::int as n
from public.user_profiles group by 1, 2 order by 1, 2;
-- legacy | active | 3
-- legacy | inactive | 4
```

| Version | Name | State |
| --- | --- | --- |
| `20260925011529` | `e01_offer_versions` | applied (E02 RPCs depend on it; [#42](https://github.com/noahjdevine/wanderbite/pull/42)) |
| `20260925175518` | `e02_capacity_binding` | applied |
| `20260925215534` | `e02_b_credit_ledger` | applied |
| `20260927220000` | `e02_rollover_credits` | applied |
| `20260929180338` | `e02_assign_carried_credit` | applied |
| `20260929201138` | `e02_credit_safe_swaps` | applied |

`vercel.json` schedules `/api/cron/issue-credit-catchup` at `0 7 * * *` and `/api/cron/rollover-credits` at `30 7 * * *`. Whether `main` auto-deploys to Vercel production is **unknown** (no production workflow under `.github/`). Hosted `cron_runs` does show both jobs firing: `issue-credit-catchup` 4 `success` rows, last `2026-10-01 07:00:02.645513+00`; `rollover-credits` 4 `success` rows, last `2026-10-01 07:30:28.248545+00`. Same query grouped by `job_name, status`.

With 0 `credits` profiles, `rollover_credits` is never called. `src/lib/challenges/rollover-credits.ts` returns when `listProfiles` is empty (lines 94–96) and only then calls `rolloverUser` for pending items (lines 128–133). `src/app/api/cron/rollover-credits/route.ts` wires that RPC at lines 47–51. A missing `20260927220000` would fail only after the first credits profile is snapshotted. A missing `20260925215534` still fails immediately: the select on `workflow_version` (route lines 36–39) throws before any profile list exists.

**Follow-up, not this PR.** Applied state is confirmed above. A separate approved PR should run `npm run types:db` and replace the hand-edited `src/types/database.types.ts` touched by [#39](https://github.com/noahjdevine/wanderbite/pull/39), [#41](https://github.com/noahjdevine/wanderbite/pull/41), [#46](https://github.com/noahjdevine/wanderbite/pull/46), and [#47](https://github.com/noahjdevine/wanderbite/pull/47). Do not run it here.

## 3. Next slice (spec only)

**In progress in a separate PR ([#55](https://github.com/noahjdevine/wanderbite/pull/55), open, files `swap-challenge.ts`, `generate.ts`, `restaurant-safety.ts`, `restaurant-safety.test.ts`). That PR is reviewed against the criteria below.** This doc does not implement the fix and does not review that diff.

The rule being restored is `.cursor/rules/project-context.mdc` Business Rule 2 (line 43, “Max 2 redemptions per restaurant per rolling 12 months”) and `Docs/build-kit.md` §3 (lines 27–28, the same sentence). `redemptionCooldownOk` already uses `subMonths(now, 12)` (`src/lib/challenges/restaurant-safety.ts` lines 18–19).

### Copy inventory

| Copy | Lines | Window | Eligibility |
| --- | --- | --- | --- |
| `swap-challenge.ts` credit path | `subYears` line 305; inline filters lines 498–519 | twelve years | inline dietary, allergy, cuisine, verified dates |
| `swap-challenge.ts` legacy path | `subYears` line 558; inline filters lines 765–790 | twelve years | same inline checks |
| `generate.ts` `cyclesLast12` | `subYears` line 275; query lines 405–409 | twelve years | variety cycle count, not the redemption helper |
| `generate.ts` `redemptionHardOk` | lines 460–461 | helper | already `redemptionCooldownOk` |
| `carried-assign-pool.ts` | lines 69–78 | helper | already `passesRestaurantHardFilters` |
| `supply-simulation.ts` | lines 332 and 439 | helper | already `redemptionCooldownOk` / `passesRestaurantHardFilters` |
| `assign-carried-gate.ts` | lines 5–10 | none | no eligibility filter. `assign-carried-credit.ts` calls the gate (line 101), the pool (line 156), and `passesRestaurantHardFilters` (line 227) |

**D8. Move the inline dietary, allergy, and cuisine checks?** A) Both swap paths call `passesRestaurantHardFilters` in [#55](https://github.com/noahjdevine/wanderbite/pull/55). B) That PR only replaces the cooldown math with `redemptionCooldownOk`; the inline checks stay. **Recommended, needs Noah: B.** `passesRestaurantHardFilters` does not emit the dietary `console.warn` those paths have today. Unifying filters is a later slice.

**D3. Variety `cycle_month` bounds. Decided by Noah.** The six-month and twelve-month variety lookbacks both use full Chicago calendar months. With `now` in Chicago month M, the six-month window excludes cycles from M−6 through M−1, and the twelve-month window excludes cycles from M−12 through M−1. `varietyCycleMonthLowerBound(now, months)` in `src/lib/challenges/restaurant-safety.ts` is the Chicago month start of `chicagoMonthStart(now)` minus `months` months (`yyyy-MM-dd`). A cycle counts when `cycle_month >=` that bound and `cycle_month < chicagoMonthStart(now)`. An October 2025 cycle stays blocked through October 2026 and is eligible again in November 2026 on the twelve-month rule. An April 2026 cycle is eligible again in November 2026 on the six-month rule. The redemption cooldown is a separate rule and stays rolling twelve months: `verified_at >= subMonths(now, 12)` via `redemptionCooldownOk`.

### Cooldown cases

`redemptionCooldownOk`: a verified time counts when `at >= subMonths(now, 12)` (and a single time inside six months blocks). One counted visit stays eligible. Two counted visits, both outside six months, are not. `vitest.config.ts` does not set `TZ` (lines 4–10). `subMonths` is local. These rows were checked with `date-fns` under `TZ=UTC` and `TZ=America/Chicago` on 2026-10-01, and the boolean matches in both. The vitest file must pass under both.

| Case | `now` | `verified_at` | Eligible |
| --- | --- | --- | --- |
| UTC 1st, Chicago still September | `2026-10-01T00:30:00.000Z` | `2025-09-01T00:30:00.000Z` | true |
| Exactly 12 months, one visit (counts, does not block) | `2026-10-01T06:00:00.000Z` | `2025-10-01T06:00:00.000Z` | true |
| Exactly 12 months plus one later visit (boundary counts) | `2026-10-01T06:00:00.000Z` | `2025-10-01T06:00:00.000Z`, `2025-11-01T06:00:00.000Z` | false |
| 12 months + 1 day, plus one in-window visit | `2026-10-01T06:00:00.000Z` | `2025-09-30T06:00:00.000Z`, `2025-11-01T06:00:00.000Z` | true |
| DST spring, at or after both cutoffs | `2026-03-08T08:00:00.000Z` | `2025-03-08T09:00:00.000Z`, `2025-08-08T08:00:00.000Z` | false |
| DST spring, before both cutoffs, plus one in-window visit | `2026-03-08T08:00:00.000Z` | `2025-03-08T07:59:59.999Z`, `2025-08-08T08:00:00.000Z` | true |
| DST fall, at or after both cutoffs | `2026-11-01T07:00:00.000Z` | `2025-11-01T07:00:00.000Z`, `2025-12-01T07:00:00.000Z` | false |
| DST fall, before both cutoffs, plus one in-window visit | `2026-11-01T07:00:00.000Z` | `2025-11-01T05:59:59.999Z`, `2025-12-01T07:00:00.000Z` | true |
| Month-end, March 31 stays March 31 | `2027-03-31T15:00:00.000Z` | `2026-03-31T15:00:00.000Z`, `2026-08-31T15:00:00.000Z` | false |
| One day before that March cutoff | `2027-03-31T15:00:00.000Z` | `2026-03-30T15:00:00.000Z`, `2026-08-31T15:00:00.000Z` | true |
| Leap clamp, Feb 29 → Feb 28 | `2028-02-29T15:00:00.000Z` | `2027-02-28T15:00:00.000Z`, `2027-07-29T15:00:00.000Z` | false |
| 1 ms before the clamped cutoff | `2028-02-29T15:00:00.000Z` | `2027-02-28T14:59:59.999Z`, `2027-07-29T15:00:00.000Z` | true |
| One visit 13 months ago | `2026-10-01T06:00:00.000Z` | `2025-09-01T06:00:00.000Z` | true |
| Two visits inside 12 months, outside 6 | `2026-10-01T06:00:00.000Z` | `2025-11-01T06:00:00.000Z`, `2026-03-01T07:00:00.000Z` | false |

A spring visit at `2025-03-08T08:30:00.000Z` is inside the UTC cutoff (`2025-03-08T08:00:00.000Z`) and outside the Chicago cutoff (`2025-03-08T09:00:00.000Z`). Do not use that instant as one shared expected value.

**Tests.** Vitest on the helper for the table, under both `TZ` values, plus source guards that both swap paths call `redemptionCooldownOk` and do not import `subYears`. `npm run test:db` is regression only. Manual: disposable users only; do not change a real `workflow_version`. **Rollback:** revert the app commit. No new SQL.

**Out of scope.** Credits cutover, `db push`, `types:db`, new packages, supply simulation, E04, SQL cooldown inside the RPCs, `stripe.exe`, doc-drift edits, G13-B, SEC-14, checkout, AI ceilings, marking E02 or E04 complete.

## 4. Doc drift (do not apply)

`.cursor/rules/project-context.mdc` line 37 says `challenges`; the table is `challenge_cycles` (`Docs/build-kit.md` line 19). Line 38 says `challenge_items.challenge_id`; `swap-challenge.ts` line 310 uses `cycle_id`. Line 36 says `discount_cents` and `valid_from`; `generate.ts` line 331 selects `discount_amount_cents`, `max_redemptions_per_month`, and `active`. Line 39 omits `redemptions.user_id` and `verified_at`. Lines 15–16 say one swap a month and “$10 off $40+”; [#42](https://github.com/noahjdevine/wanderbite/pull/42) seals tiers and the 2000-cent pair floor, and [#48](https://github.com/noahjdevine/wanderbite/pull/48) is one Chicago-month credit swap. No `entitlement_credits`, `offer_versions`, or `workflow_version`. Proposed: rewrite from the live tables and delete the warning at lines 21–30.

`.cursor/rules/conventions.mdc` rule 1 (line 8) requires `fix/<desc>`. Agents also use `cursor/*` ([#55](https://github.com/noahjdevine/wanderbite/pull/55)). Rule 4 (line 11) says `types:db`; [#39](https://github.com/noahjdevine/wanderbite/pull/39), [#41](https://github.com/noahjdevine/wanderbite/pull/41), [#46](https://github.com/noahjdevine/wanderbite/pull/46), and [#47](https://github.com/noahjdevine/wanderbite/pull/47) hand-edited `src/types/database.types.ts`. Rule 6 (line 13) says never `git push`; agents push the feature branch and still must not `db push` or add a package without approval. Proposed: allow both branch prefixes, and point rule 4 at §2.

`Docs/build-kit.md` §3 (lines 27–35) still says $10 off $40 and `swap_count_used`, and §4 line 41 says a 30-minute token, against the 840-hour deadline in [#42](https://github.com/noahjdevine/wanderbite/pull/42). Proposed: replace those rules. Do not edit them here.

## 5. Risks and the remaining decisions

Review speed, from `gh pr view` `createdAt` / `mergedAt`: [#50](https://github.com/noahjdevine/wanderbite/pull/50) opened 2026-09-29T22:45:27Z and merged 2026-09-29T22:48:05Z (about 3 minutes); [#51](https://github.com/noahjdevine/wanderbite/pull/51) 2026-09-30T00:03:18Z to 2026-09-30T00:12:42Z (about 9 minutes); [#41](https://github.com/noahjdevine/wanderbite/pull/41) 2026-09-25T01:30:00Z to 2026-09-25T01:36:30Z (about 6 minutes). Proposed: a migration or RPC PR records its checklist in the body before merge.

Hand-edited `src/types/database.types.ts` can drift from the hosted schema confirmed in §2 until the `types:db` PR lands.

Legacy `startOfMonth` versus `chicagoMonthStart` is an open cutover item, not this slice. `generate.ts` builds `utcCycleMonthStr` with `startOfMonth` (line 269), looks up both month keys (lines 271–272), and writes `p_cycle_month` as Chicago only when the pair is version-backed (line 542). Legacy swap capacity uses `startOfMonth` (lines 559–560). A legacy-to-credits cutover can split one calendar month across two `cycle_month` values.

`Docs/g13-b-hosted-evidence.md` still has the onboarding `permission denied for table user_profiles` note, and G13-B’s checklist there is open. SEC-14 (`Docs/g14-sec-14.md`) still needs the Auth dashboard. `stripe.exe` is the tracked 31,689,728-byte blob from `3cc5256`. This plan did not execute it. `subYears(now, 12)` remains a twelve-year block until [#55](https://github.com/noahjdevine/wanderbite/pull/55) merges. The credit RPCs do not re-check it.

**D4. Where may `workflow_version` become `credits`?** A) Disposable Docker only. B) One disposable hosted user. C) Not in the cooldown PR or the gate run. **Recommended, needs Noah: C for now, then A.** This plan does not change it.

**D5. Onboarding `user_profiles` insert next?** A) The slice after the cooldown fix. B) Stay parked. C) Fold it into a G13-B evidence PR. **Recommended, needs Noah: B.**

**D6. G13-B and SEC-14?** A) Noah re-checks the open G13-B boxes and the four Auth settings. B) Close them from the repo. C) Defer both. **Recommended, needs Noah: A.** Current dashboard values are **unknown**.

**D7. `stripe.exe`?** A) Remove it in a separate PR. B) Keep it. C) Gitignore it and document how to install the CLI. **Recommended, needs Noah: A.**
