# E02 plan

Doc sync against `46dd871c` (PR #57 on `main`). Earlier draft base was `a47b90a`. **Master E02 is open. Master E04 is open.** Nothing below is a sign-off. “Landed” means the cited PR merged. Recommendations are marked **recommended, needs Noah**.

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
10. `subYears(now, 12)` removed from swap and variety. **Landed.** [#55](https://github.com/noahjdevine/wanderbite/pull/55). `src/lib/challenges/restaurant-safety.test.ts`. `swap-challenge.ts` and `generate.ts` do not reference `subYears`. Variety lookbacks use `varietyCycleMonthLowerBound`. Redemption cooldown uses `redemptionCooldownOk` / `redemptionCooldownReason`.
11. A real profile on `credits`. **Not an automatic E02 prerequisite.** Real-member cutover requires separate authorization. Those PRs forbid the cutover. Hosted count in §2 is 0.
12. Master E02 acceptance and master E04 acceptance. **Open.** No master file in the repo.

**D1. Adopt this draft?** A) Noah pastes the original list and this draft is retired. B) Accept this draft as the master list. C) Keep it unofficial until a later confirmation. **Recommended, needs Noah: C.**

### Decision: six-month supply gate

[#51](https://github.com/noahjdevine/wanderbite/pull/51) says cohort `match 10/12` is not this gate. [#52](https://github.com/noahjdevine/wanderbite/pull/52) says the selector still does not close it.

**Metric.** `src/lib/challenges/supply-simulation.ts` line 747 counts credits with `challengeItemId !== null`; line 760 sets `denominator` to `ledger.credits.length`. `baseConfig` `ks` is `[5, 4, 3, 2, 1, 0]` (line 209); each `k` uses `chicagoMonthStart` (line 488) and `issueTwoCredits` (line 495). `COVERAGE_CONFIG` (line 219) keeps those six months. Do not use `seededMatchRate` (lines 841–849). `tight_ceiling` overrides `ks` to `[0]` (line 227).

**Catalog.** A) The 29 synthetic `SUPPLY_RESTAURANTS` (lines 116–135: 12 `S*` rows plus keys `U1` through `Far2`). B) Superseded 2026-10-01: D2=B is a read-only hosted snapshot saved as gitignored JSON, not a catalog loaded into disposable Docker. C) Both. Catalog A remains the logic regression only.

**Threshold.** Superseded 2026-10-01 by D2=B below: 100% of credits over 6 Chicago months, every seeded trial. The earlier recommendation was catalog A with `numerator === denominator` on `COVERAGE_CONFIG`. [#52](https://github.com/noahjdevine/wanderbite/pull/52) printed `simulated_match=12/12` for coverage. That print is not a pass of this gate. Master E04 stays open.

**Run and record.** `npm test` (`src/lib/challenges/supply-simulation.test.ts`) and `npm run test:db` (`scripts/e02-supply-simulation.ts` via `scripts/test-database.ts`) print `simulated_match=` (`formatSupplySimulationReport`, line 940). Paste that line. No `db push`. B or C needs a loader that does not write hosted data.

**Determinism.** The simulation sorts with `byId` (line 360; lines 576 and 605). Production `generate.ts` shuffles with `randomInt` (lines 171–175) at line 527. A gate pass does not fix a member’s draw.

**D2. Gate score?** A) Catalog A, `numerator === denominator` on `COVERAGE_CONFIG`. B) Catalog B with a threshold Noah names. C) Both must pass. **Decided by Noah 2026-10-01: B, hosted active snapshot, threshold 100% of credits issued over 6 Chicago months, every seeded trial.**

### Supply gate (D2=B)

Catalog A (`SUPPLY_RESTAURANTS`, criterion 9) stays the logic regression. It is not this gate. The #51 SQL cohort is not this gate.

**Metric.** Denominator is 16 members × 6 Chicago months × 2 credits = 192. Numerator is those credits with `challengeItemId !== null` at the end of M5. A carry match counts in the numerator and is reported `matched_via_carry`. Do not use `seededMatchRate`. PASS only when numerator === denominator in every seeded trial. One unmatched credit is FAIL.

**Cohort.** `SUPPLY_GATE_COHORT`: 4 launch ZIPs (75069, 75070, 75071, 75072) × open/restricted × new/tenured. Open has no flags. Restricted uses `MEMBER_FLAGS` (vegan, peanut, italian) and counts toward 100% unless Noah later makes that persona report-only. Distance band `5_mi`, no cocktail reserve, no swaps, completion `verify_on_assign`. Tenured members get 6 unscored warm-up months (M−6..M−1, ks 11..6) on a private capacity table with offer-validity checks off. Warm-up seeds redemptions and cycles only.

**Window.** M0 is the first Chicago month whose simulated 15th 18:00Z is at or after the snapshot `exported_at`. Score M0..M5. Each month: `applyRollover` after the member’s first month, `issueTwoCredits`, carried assign (single base >= 2000), then a pair link.

**Trials.** Default 20, seeds 1..N, mulberry32 shuffle. `--seed` repeats one trial. Never `Math.random`.

**Funnel.** First failing rule on the full active catalog: outside_market, no_offer_version (legacy offers are diagnostic only; `legacy_offer_only`), offer_version_not_selectable (`offerVersionCoversDeadline`: not_yet_valid, expires_before_deadline, withdrawn), offer_tiers_invalid, missing_coordinates, dietary_exclusion, allergy, excluded_cuisine, cooldown_recent_visit_6m, cooldown_two_in_12m, capacity_full, variety_6m, variety_12m, relaxed_variety_last_month, then outside_distance at the radius actually used, then pair_below_floor / carried_below_floor. Variety uses `varietyCycleMonthLowerBound(now, 6|12)` with `cycle_month >= bound` and `< chicagoMonthStart(now)`. Redemption cooldown stays rolling (`redemptionCooldownReason` / `redemptionCooldownOk`). Each failing line also prints survivor counts: active, market, offer_version, selectable, coords, dietary, allergy, cuisine, cooldown, capacity, distance, variety, floor, need, binding.

**Offer versions.** A restaurant is selectable only with a current offer version that passes the same window as `version_selection_ok` (`20260925175518`) and that `link_pending_credits` (`20260925215534`) requires. Legacy `restaurant_offers` do not make a restaurant eligible. Pair floor is lowest-tier `discount_cents` summed >= 2000, the same cents `offer_lowest_tier_cents` adds in `link_pending_credits`.

**Floor-aware selector.** No production caller of `link_pending_credits` exists under `src/` (the SQL function receives the pair; it does not choose it). The gate uses `selectDistancePool` with `poolSatisfies` / `floorPairExists` / `pickFloorPair`: strict variety, then relaxed variety, then at most one larger distance band. Carried credits drop bases under 2000 cents before that distance selection. A gate PASS measures supply under this policy. It does not prove live `generate.ts`, which still picks two candidates at random (`pickDistinctRestaurants`) and can receive `pair_below_floor` from the RPC. Production reuse is a later slice and must preserve `restaurant_base_cents` semantics: use the referenced current offer version when `current_offer_version_id` is set, with no legacy fallback when that version is missing or invalid; only when no current version is referenced, use the first active legacy offer ordered by id when `0 < discount <= minimum spend`. The RPC stays authoritative.

**How Noah runs it.** An agent or CI must not run this SQL against the hosted project. In the Supabase SQL editor, open `scripts/sql/e02-supply-snapshot.sql`, highlight only the `select` statement, and use "Run selected" (the editor shows only the last statement's result). Copy only the single cell value. Do not use "Export as JSON"; that wraps the cell in `[{"snapshot":...}]`. Save the cell to `.supply-gate/hosted-catalog.json` (gitignored). psql alternative: `psql -qAt -f scripts/sql/e02-supply-snapshot.sql > .supply-gate/hosted-catalog.json`. Then `npm run supply:gate`. Paste only these lines: `result`, `unmatched_by_month`, `unmatched_by_rule`, and every `shortfall` line. Never paste or commit the snapshot.

**Checklist.** Six-month supply gate (D2=B): built in [#56](https://github.com/noahjdevine/wanderbite/pull/56), corrected in [#57](https://github.com/noahjdevine/wanderbite/pull/57), not yet run on the hosted snapshot. Result unknown. Open. Criterion 11, a real profile on `credits`, is not an automatic E02 prerequisite. Real-member cutover requires separate authorization. #52’s configurable simulation remains required coverage, including swaps, spending ceilings, delayed completion, rollover, capacity utilization, and required customer spend. The fixed-cohort gate does not replace that simulation. Master E02 is open. Master E04 is open. This doc does not claim the gate passed and does not claim E02 or E04 acceptance.

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

## 3. Cooldown on main, and the next measurement

[#55](https://github.com/noahjdevine/wanderbite/pull/55) is merged. It landed in `swap-challenge.ts`, `generate.ts`, `restaurant-safety.ts`, and `restaurant-safety.test.ts`. This doc does not change that code.

On `main`, redemption eligibility cutoffs are America/Chicago wall-clock months via `subMonthsChicago` in `src/lib/challenges/restaurant-safety.ts`. `redemptionCooldownOk` is true only when `redemptionCooldownReason` is null. A verified visit at or after the six-month cutoff blocks (`recent_visit_6m`). Two verified visits at or after the twelve-month cutoff block (`two_in_12m`) when the six-month rule does not. [#57](https://github.com/noahjdevine/wanderbite/pull/57) (merge `46dd871c`, head `ce7e897e`) sets the DST rules: a nonexistent spring-forward wall time resolves to the transition instant; an ambiguous fall-back wall time resolves to the earlier occurrence; while `now` is inside the later copy of the repeated hour, the cutoff holds at the value it had one millisecond before the backward transition. Month-end and leap-day clamping is unchanged (31 March stays 31 March; 29 February clamps to 28 February). Those rules are in `subMonthsChicago` and asserted under `Chicago DST cooldown cutoff` in `src/lib/challenges/restaurant-safety.test.ts`.

`rollingTwelveMonthStart` still returns process-local `subMonths(now, 12)`. It is not an eligibility caller. On `main` the only references are that function and `restaurant-safety.test.ts`.

### Copy inventory

| Copy | Window | Eligibility |
| --- | --- | --- |
| `swap-challenge.ts` credit and legacy `passesHard` | `redemptionCooldownOk` | no `subYears`; inline dietary, allergy, and cuisine checks remain |
| `generate.ts` variety | `varietyCycleMonthLowerBound(now, 6)` and `(now, 12)`, then `cycle_month < chicagoMonthStart(now)` | not the redemption helper |
| `generate.ts` `redemptionHardOk` | helper | `redemptionCooldownOk` |
| `carried-assign-pool.ts` | helper | `passesRestaurantHardFilters` |
| `supply-simulation.ts` / `supply-gate.ts` | helper | `redemptionCooldownOk` / `redemptionCooldownReason` and `varietyCycleMonthLowerBound` |
| `assign-carried-gate.ts` | none | no eligibility filter. `assign-carried-credit.ts` calls the gate, the carried pool, and `passesRestaurantHardFilters` |

**D8. Move the inline dietary, allergy, and cuisine checks?** A) Both swap paths call `passesRestaurantHardFilters` in [#55](https://github.com/noahjdevine/wanderbite/pull/55). B) That PR only replaces the cooldown math with `redemptionCooldownOk`; the inline checks stay. **Recommended, needs Noah: B.** `passesRestaurantHardFilters` does not emit the dietary `console.warn` those paths have today. Unifying filters is a later slice.

**D3. Variety `cycle_month` bounds. Decided by Noah.** The six-month and twelve-month variety lookbacks both use full Chicago calendar months. With `now` in Chicago month M, the six-month window excludes cycles from M−6 through M−1, and the twelve-month window excludes cycles from M−12 through M−1. `varietyCycleMonthLowerBound(now, months)` in `src/lib/challenges/restaurant-safety.ts` is the Chicago month start of `chicagoMonthStart(now)` minus `months` months (`yyyy-MM-dd`). A cycle counts when `cycle_month >=` that bound and `cycle_month < chicagoMonthStart(now)`. An October 2025 cycle stays blocked through October 2026 and is eligible again in November 2026 on the twelve-month rule. An April 2026 cycle is eligible again in November 2026 on the six-month rule. The redemption cooldown is a separate rule and stays rolling twelve months: `verified_at >= subMonths(now, 12)` via `redemptionCooldownOk`.

### Cooldown cases

`redemptionCooldownReason` blocks when a verified time is `>= subMonthsChicago(now, 6)`, and otherwise when two verified times are `>= subMonthsChicago(now, 12)`. One verified visit inside twelve months and outside six stays eligible. The process timezone does not move these cutoffs. `rollingTwelveMonthStart` is the separate process-local instant above and is not this rule.

The earlier process-local `subMonths` case table is not the eligibility cutoff. Those 2026-10-01 `TZ=UTC` / `TZ=America/Chicago` date-fns rows are not restated as `subMonthsChicago` results. Month-end and leap clamping still follow the helper: `subMonthsChicago` of `2027-03-31T15:00:00.000Z` by 12 months is `2026-03-31T15:00:00.000Z`, and of `2028-02-29T15:00:00.000Z` by 12 months is `2027-02-28T15:00:00.000Z` (`restaurant-safety.test.ts`).

**Tests.** `src/lib/challenges/restaurant-safety.test.ts` covers `subMonthsChicago`, both swap `passesHard` paths (`redemptionCooldownOk`, no `subYears`), and both variety bounds. `npm run test:db` is regression only. Manual: disposable users only; do not change a real `workflow_version`. **Rollback:** revert the app commit. No new SQL.

**Next measurement.** Gate tooling landed in [#56](https://github.com/noahjdevine/wanderbite/pull/56). DST cutoffs and floor-aware distance expansion were corrected in [#57](https://github.com/noahjdevine/wanderbite/pull/57). The hosted D2 gate run is the next outstanding measurement: the hosted snapshot plus `npm run supply:gate`, as specified in §1. Record `result`, `unmatched_by_month`, `unmatched_by_rule`, and every `shortfall` line before deciding subsequent work. That result is unknown. This doc does not predict pass or fail from restaurant count, and a recorded result is not E02 or E04 acceptance.

**Out of scope.** Credits cutover, `db push`, `types:db`, new packages, supply simulation, E04, SQL cooldown inside the RPCs, `stripe.exe`, G13-B, SEC-14, checkout, AI ceilings, marking E02 or E04 complete.

## 4. Doc drift

Applied in this docs-only sync. No product behavior change.

`.cursor/rules/project-context.mdc` now follows `supabase/migrations`: `challenge_cycles` (not `challenges`), `challenge_items.cycle_id`, `restaurant_offers` columns as migrated (`discount_amount_cents`, `min_spend_cents`, `max_redemptions_per_month`, `active`; no `discount_cents` or `valid_from`), `redemptions.user_id` and `verified_at`, plus `entitlement_credits`, `offer_versions`, and `user_profiles.workflow_version` (`legacy` default, or `credits`). `user_profiles` and `user_preferences` stay. The verify-and-correct warning is removed. Business rules cite sealed tiers and the 2000-cent pair floor ([#42](https://github.com/noahjdevine/wanderbite/pull/42)), the assignment deadline as implemented ([#42](https://github.com/noahjdevine/wanderbite/pull/42)), one linked-credit swap per Chicago month ([#48](https://github.com/noahjdevine/wanderbite/pull/48)), `redemptionCooldownOk`, and `varietyCycleMonthLowerBound`. The D2 command `npm run supply:gate` is named. No hosted gate result is claimed. Live `generate.ts` is not floor-aware. Members are not described as being on credits.

`.cursor/rules/conventions.mdc` rule 1 allows `cursor/*` branch names alongside `fix/<short-description>` (naming only). Rule 4 still waits for confirmation before `db push`, and notes that hand-edited types ([#39](https://github.com/noahjdevine/wanderbite/pull/39), [#41](https://github.com/noahjdevine/wanderbite/pull/41), [#46](https://github.com/noahjdevine/wanderbite/pull/46), [#47](https://github.com/noahjdevine/wanderbite/pull/47)) need a separate approved `types:db` PR. Push, package, and spending rules are unchanged.

`Docs/build-kit.md` §3 and the §4 issuance line now describe the sealed-tier pair floor, the Chicago-month credit swap, `redemptionCooldownOk`, and the traced expiry clocks. Other build-kit sections are unchanged.

## 5. Risks and the remaining decisions

Review speed, from `gh pr view` `createdAt` / `mergedAt`: [#50](https://github.com/noahjdevine/wanderbite/pull/50) opened 2026-09-29T22:45:27Z and merged 2026-09-29T22:48:05Z (about 3 minutes); [#51](https://github.com/noahjdevine/wanderbite/pull/51) 2026-09-30T00:03:18Z to 2026-09-30T00:12:42Z (about 9 minutes); [#41](https://github.com/noahjdevine/wanderbite/pull/41) 2026-09-25T01:30:00Z to 2026-09-25T01:36:30Z (about 6 minutes). Proposed: a migration or RPC PR records its checklist in the body before merge.

Hand-edited `src/types/database.types.ts` can drift from the hosted schema confirmed in §2 until the `types:db` PR lands.

Legacy `startOfMonth` versus `chicagoMonthStart` is an open cutover item, not this slice. `generate.ts` builds `utcCycleMonthStr` with `startOfMonth` (line 272), looks up both month keys (lines 273–275), and writes `p_cycle_month` as Chicago only when the pair is version-backed (line 545). Legacy swap capacity uses `startOfMonth` (lines 550–551). A legacy-to-credits cutover can split one calendar month across two `cycle_month` values.

`Docs/g13-b-hosted-evidence.md` still has the onboarding `permission denied for table user_profiles` note, and G13-B’s checklist there is open. SEC-14 (`Docs/g14-sec-14.md`) still needs the Auth dashboard. `stripe.exe` is the tracked 31,689,728-byte blob from `3cc5256`. This plan did not execute it. [#55](https://github.com/noahjdevine/wanderbite/pull/55) merged: `subYears` is gone from `swap-challenge.ts` and `generate.ts`. The credit RPCs still do not apply `redemptionCooldownOk`.

**D4. Where may `workflow_version` become `credits`?** A) Disposable Docker only. B) One disposable hosted user. C) Not in the cooldown PR or the gate run. **Recommended, needs Noah: C for now, then A.** This plan does not change it.

**D5. Onboarding `user_profiles` insert next?** A) The slice after the cooldown fix. B) Stay parked. C) Fold it into a G13-B evidence PR. **Recommended, needs Noah: B.**

**D6. G13-B and SEC-14?** A) Noah re-checks the open G13-B boxes and the four Auth settings. B) Close them from the repo. C) Defer both. **Recommended, needs Noah: A.** Current dashboard values are **unknown**.

**D7. `stripe.exe`?** A) Remove it in a separate PR. B) Keep it. C) Gitignore it and document how to install the CLI. **Recommended, needs Noah: A.**
