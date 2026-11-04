# E02 plan

Synced through **#85** (merge `ba3ff4e797ae8db73b5228cf603965c1bd4e058a`). That range includes [#73](https://github.com/noahjdevine/wanderbite/pull/73) merge `63b978cc113c422bf33574c250ef423e32d4f8fe`, [#74](https://github.com/noahjdevine/wanderbite/pull/74) merge `976b62466eade4234420e84e836c2526a6d2eef1`, [#75](https://github.com/noahjdevine/wanderbite/pull/75) merge `390fac6e977ca07144c445cc5c542df91882f9af`, [#76](https://github.com/noahjdevine/wanderbite/pull/76) merge `1d4f94fcfb83ea950840cdead1b13bd9566f6d9e`, [#77](https://github.com/noahjdevine/wanderbite/pull/77) merge `fb26fd6ee37220fd01d87b8aad666da89014fcc5`, [#78](https://github.com/noahjdevine/wanderbite/pull/78) merge `36edc5ebc4b109d6badb640cf49af273bae3827e`, [#79](https://github.com/noahjdevine/wanderbite/pull/79) merge `cd505ba8e93658a45f8fa7ca1fdba87c0b30b027`, [#81](https://github.com/noahjdevine/wanderbite/pull/81) merge `831e7ed460c1bb565b170c0b5d812073a5f62753`, [#82](https://github.com/noahjdevine/wanderbite/pull/82) merge `eced2864f2aeef01fea5de7d7e092ae7e30e9589`, [#83](https://github.com/noahjdevine/wanderbite/pull/83) merge `4edc6008efb82c3082503bc8ea8931a9ba2aae84`, [#84](https://github.com/noahjdevine/wanderbite/pull/84) merge `44968b87c41cb2a35e3266cd2a795670d1a951cd`, and [#85](https://github.com/noahjdevine/wanderbite/pull/85) merge `ba3ff4e797ae8db73b5228cf603965c1bd4e058a`. Prior sync was **#72** (merge `a1c651c53f510c8eef293a35b276313ce194e8e0`). Earlier baseline remains **#62** (merge `082b96a`; that range also includes [#65](https://github.com/noahjdevine/wanderbite/pull/65) merge `be56b94`; prior baseline `46818e2e` / PR #60). Earlier draft base was `a47b90a`. **Master E02 is open. Master E04 is open.** Nothing below is a sign-off. “Landed” means the cited PR merged. Recommendations are marked **recommended, needs Noah**.

**[#63](https://github.com/noahjdevine/wanderbite/pull/63)** (merge `3666c1682513f8f7a628f9345c67842fa123307e`): `fix(deps): patch critical next/sentry/dompurify/zod advisories` — bumps `next` and `eslint-config-next` to 16.4.3, `@sentry/nextjs` to 10.78.0, and `zod` to ^4.6.7, adds a `dompurify` 3.4.17 override, and sets `react-hooks/set-state-in-effect` and `react-hooks/preserve-manual-memoization` to `warn` in `eslint.config.mjs` only.

**[#64](https://github.com/noahjdevine/wanderbite/pull/64)** (merge `db1b34e64b5e3661757e471507165fe6704b747c`): `fix(lint): resolve React Compiler hook rules for Next 16.4` — restores those two rules to `error` and refactors the flagged call sites, with no `eslint-disable` in `src/`.

**[#65](https://github.com/noahjdevine/wanderbite/pull/65)** (merge `be56b9400ad14d3f0d5dd37a92b323f8a490eabe`): `fix(roulette): cache excluded-cuisines snapshot` — `src/lib/excluded-cuisines-store.ts` caches the `useSyncExternalStore` snapshot by the raw `wb_excluded_cuisines` string and shares one frozen empty array for missing or invalid storage and the server snapshot, so `/roulette` does not loop on “The result of getSnapshot should be cached”.

**[#66](https://github.com/noahjdevine/wanderbite/pull/66)** (merge `2e712dca271a491b1129548a47b846a84c54688b`): `fix(generate): pre-filter version-bound capacity` — `passesHard` drops a version-bound restaurant whose current offer is withdrawn, outside `version_selection_ok`, or full in any `reserve_version_buckets` month before `selectDistancePool` / `pickDistinctRestaurants`; the RPC stays authoritative.

**[#67](https://github.com/noahjdevine/wanderbite/pull/67)** (merge `06ed71cbcd32b802de6363d78407708c80029a84`): `feat(catalog): bulk-import restaurants and publish test offers` — `npm run catalog:import` plans and applies a CSV or JSON restaurant file; `--test-offers` appends an `offer.test_mark` audit row with `is_test: true`; a row with `is_test_offer: false` is `refused_real_offer` unless `--publish-real-offers` is set.

**[#68](https://github.com/noahjdevine/wanderbite/pull/68)** (merge `c5dadf4f57e168b602614cb4f183de53675481ff`): Report test supply separately from the E02 supply gate — snapshot schema `wanderbite.e02.supply_snapshot.v2` adds `test_offer_version_ids`; `result=` is the full catalog and is marked `(all supply)` when selectable test supply is greater than 0; a v2 exit code follows `real_supply_result`; a PASS on `result=` that includes test versions is not a gate result.

**[#69](https://github.com/noahjdevine/wanderbite/pull/69)** (merge `b9a341b086884a09c4c0767e9a2b9b176a744633`): `fix(supply-gate): print real shortfall lines and align test markers` — when `test_supply selectable` is greater than 0 the report adds `real_unmatched_by_month`, `real_unmatched_by_persona`, and `real_shortfall`, and both the snapshot and `isTestOfferAuditMarker` require JSON boolean `true` (`(metadata->'is_test') = 'true'::jsonb`).

**[#70](https://github.com/noahjdevine/wanderbite/pull/70)** (merge `9baa2fbd05b6f344967e42aab6ad2a34210abb42`): `fix(supply-gate): add a read-only preflight before the snapshot` — `scripts/sql/e02-supply-preflight.sql` returns one jsonb cell (`wanderbite.e02.supply_preflight.v1`); if `string_true_test_markers.count` is greater than 0, stop and do not hand-edit hosted rows.

**[#71](https://github.com/noahjdevine/wanderbite/pull/71)** (merge `d6c29cebbbb4731acc9b2dc35fc96c007f0b29a3`): `fix(catalog-import): keep stored cuisine tags on a from-db round trip` — an unknown cuisine tag already stored on the matched restaurant is a warning and is kept; the same tag on a new row, or a new unknown tag on a matched row, is still an error.

**[#72](https://github.com/noahjdevine/wanderbite/pull/72)** (merge `a1c651c53f510c8eef293a35b276313ce194e8e0`): Keep active members out of paused onboarding checkout — `subscription_status = 'active'` goes to `/challenges` from sign-in and from `/onboarding`; structured street, city, state, and ZIP win when all four are set; the strict legacy line `street, city, ST ZIP` is used only when all four structured fields are blank.

**[#73](https://github.com/noahjdevine/wanderbite/pull/73)** (merge `63b978cc113c422bf33574c250ef423e32d4f8fe`): docs sync through #72.

**[#74](https://github.com/noahjdevine/wanderbite/pull/74)** (merge `976b62466eade4234420e84e836c2526a6d2eef1`): Passport stops selecting ungranted lat/lon.

**[#75](https://github.com/noahjdevine/wanderbite/pull/75)** (merge `390fac6e977ca07144c445cc5c542df91882f9af`): E03 push-to-talk. Migration `20261103200516` was applied to hosted on 2026-11-03. `OPENAI_API_KEY` is set in Vercel per Noah; a redeploy is needed for it to take effect.

**[#76](https://github.com/noahjdevine/wanderbite/pull/76)** (merge `1d4f94fcfb83ea950840cdead1b13bd9566f6d9e`): shared candidates service; carried assign routed; generate/swaps were shadow mode.

**[#77](https://github.com/noahjdevine/wanderbite/pull/77)** (merge `fb26fd6ee37220fd01d87b8aad666da89014fcc5`): E04-A2: service authoritative for generate and swaps. Landed.

**[#78](https://github.com/noahjdevine/wanderbite/pull/78)** (merge `36edc5ebc4b109d6badb640cf49af273bae3827e`): E04-B persistent reveal + brief. Landed. Migration `20261103220000` was applied to hosted on 2026-11-03.

**[#79](https://github.com/noahjdevine/wanderbite/pull/79)** (merge `cd505ba8e93658a45f8fa7ca1fdba87c0b30b027`): E04-C monthly curation UI. Landed. Flag `E04_MONTHLY_REVEAL_ENABLED` default off.

**[#81](https://github.com/noahjdevine/wanderbite/pull/81)** (merge `831e7ed460c1bb565b170c0b5d812073a5f62753`): E04-C2 crons skip curation-eligible members when the flag is on; narrow schema fallback. Landed.

**[#82](https://github.com/noahjdevine/wanderbite/pull/82)** (merge `eced2864f2aeef01fea5de7d7e092ae7e30e9589`): E04-C3 one ready-to-pick email per period when the reveal flag is on. Landed. Migration `20261103234500` was applied to hosted on 2026-11-03.

**[#83](https://github.com/noahjdevine/wanderbite/pull/83)** (merge `4edc6008efb82c3082503bc8ea8931a9ba2aae84`): E04 AI ranking behind `E04_AI_RANKING_ENABLED`, default off. Landed on `gpt-4.1-mini`.

**[#84](https://github.com/noahjdevine/wanderbite/pull/84)** (merge `44968b87c41cb2a35e3266cd2a795670d1a951cd`): E04 ranking uses Claude Haiku `claude-haiku-4-5-20251001` when both flags are exactly `true`. One 8s deadline covers reserve and the model fetch. No new migration. Flags stay off.

**[#85](https://github.com/noahjdevine/wanderbite/pull/85)** (merge `ba3ff4e797ae8db73b5228cf603965c1bd4e058a`): Pre-dispatch ledger RPCs are capped at the 8s reveal deadline. A reserve that returns after that cap is released before dispatch. Post-dispatch settle is awaited with a 2s bound and a static log if that bound is exceeded. Credits-workflow members get `credits_pending` while the reveal flag is on. The flag-on loader reads the Chicago month first. Acceptance tests are in `src/lib/challenges/e04-acceptance.test.ts`. The inactive-brief case is in `supabase/tests/e04-reveal.sql`. Landed. **Master E04 stays open.**

All E04 migrations are applied to hosted as of 2026-11-03: `20261103220000` and `20261103234500`. E04-A shared eligibility service landed. **Master E02 is open. Master E04 is open.** The D2=B hosted supply gate is an outstanding measurement, separate from the E04 deferred list. Last recorded `real_supply_result=FAIL 0/192` on test supply. This doc does not predict that measurement.

### Master E04 acceptance

| Item | Status | Test / evidence |
| --- | --- | --- |
| 1. Ordinary reveal and Surprise Me use the same monthly candidate service | Test evidence landed (#85) | `acceptance 1 ordinary reveal and Surprise Me share the monthly candidate service` in `src/lib/challenges/e04-acceptance.test.ts` |
| 2. A brief cannot assign an ineligible or unknown restaurant | Test evidence landed (#85) | `acceptance 2 a brief cannot assign an ineligible or unknown restaurant` |
| 3. Brief text cannot grant membership or credits | Test evidence landed (#85) | `acceptance 3 brief text cannot grant membership or credits`; `supabase/tests/e04-reveal.sql` inactive brief writes no pair and no credits |
| 4. Refresh, retry, and two tabs keep one stored pair | Test evidence landed (#85) | `acceptance 4 refresh retry and a second tab keep one stored pair`; `supabase/tests/e04-reveal.sql` retry returns the saved reveal; `scripts/e04-reveal-concurrency.ts` |
| 5. One model call; repeats return the stored result | Test evidence landed (#85) | `acceptance 5 one model call and repeats return the stored result` |
| 6. Unavailable candidate: safe retry or deterministic pair, no partial pair, credits preserved | Test evidence landed (#85) | `acceptance 6 an unavailable candidate commits no partial pair`; `supabase/tests/e04-reveal.sql` capacity miss |
| 7. One swap per Chicago month; swapped slot reason stays correct | Test evidence landed (#85) | `acceptance 7 one Chicago-month swap leaves the swapped slot reason`; `supabase/tests/e02-credit-safe-swaps.sql` |
| 8. Cron cannot race reveal into a second pair | Test evidence landed (#85) | `acceptance 8 a cron and a reveal still leave one pair`; cron skip in #81; `scripts/e04-reveal-concurrency.ts` |
| 9. Follow-up prose cannot change the saved assignment | Test evidence landed (#85) | `acceptance 9 follow-up prose does not change the saved assignment`; `supabase/tests/e04-reveal.sql` retry |
| 10. AI off, slow, over budget, or invalid still reveals deterministically | Test evidence landed (#85) | `acceptance 10 deterministic reveal when AI is off slow over budget or invalid` |

This table is test evidence from #85. It is not sign-off. E04 acceptance stays open until Noah confirms.

Hung pre-dispatch ledger RPC: `acceptance a hung pre-dispatch ledger RPC commits the deterministic pair within the bound` and `returns within the deadline when a pre-dispatch ledger RPC never resolves`. Settlement after dispatch: `logs and still reveals when settlement after dispatch exceeds its bound`.

Revealed-pair display (flag on): offer terms come from the bound offer version via `lowestSealedBase` (`loadChallengeItemsWithRestaurants`). The visit deadline is `challenge_items.redemption_deadline` formatted in America/Chicago. Completion is Completed or Not completed yet. Swaps remaining is 0/1 or 1/1 for the loaded cycle. At 11:30pm America/Chicago on the last day of a month the flag-on loader reads the Chicago month first (`acceptance flag on keeps the Chicago pair visible at 11:30pm CT`). Flag off keeps the single workflow month. Boost windows are not shown.

**Deferred.** Carried-credit reveal: Noah decided on 2026-11-03 to build it as the first slice immediately after the real-member credits cutover, which needs separate authorization, not before. After credits cutover: build E04 carried-credit reveal next. Boost windows wait on E07. No flag is set by this slice.

## E05 recipes

**E05-A1 (pending merge, this PR).** Recipe content model and saved recipes. Flag `E05_RECIPES_ENABLED` stays unset; only the exact string `true` turns cards on. A signed-in member then sees “Recipes inspired by this visit” on a challenge restaurant card and on the matching passport visit, and saved recipes on `/journey`. Demo rows live in `scripts/fixtures/e05-demo-recipes.ts` and `scripts/seed.ts` (`inspired_by`, `is_demo`, “Demo content”). They are not restaurant-approved claims. Saving a recipe does not write a credit, verified visit, badge, or drawing entry. Checked-at is shown in America/Chicago. **Master E02 is open. Master E04 is open.**

Migrations `20261104013000_e05_recipes.sql` and `20261104021500_e05_recipe_menu_provenance.sql` are **not applied to hosted**. Do not run `npm run types:db` against hosted for this slice. After Noah approves, the hosted command is `npx supabase db push --linked --yes`. Until then the tables are unused on hosted and the flag stays off, so current pages match `main`.

**E05-A2: open.** Assistant recipe questions. Journal-entry linking is not in A1; leave it for A2.

**E05-B: open.** Later, generate inspired-by home recipes from a restaurant’s public online menu (dish name, description, and listed ingredients). The A1 model can hold that row: `recipe_type = inspired_by`, `source_kind = public_menu`, `source_url` for the menu, `retrieved_at`, `menu_wording = paraphrase`, and a paraphrased `description`. The card still says “An at-home take, not the restaurant's recipe.” `menu_wording` has no verbatim value, so a menu description is stored only as a paraphrase. No scraping or URL ingestion in this PR. The maintenance pipeline stays open.

**D2=B.** Outstanding hosted measurement, not an E04 deferred item. Last recorded `real_supply_result=FAIL 0/192` on test supply (2026-11-02 run; `result=PASS (all supply) 192/192` includes test versions and is not a gate result). This doc does not predict the next measurement.

**Catalog conversion (PR #59).** `npm run catalog:convert` and `scripts/e02-catalog-conversion.ts` are an offline dry-run export/manifest only. They do not publish offer versions or mutate hosted data; any apply/backfill requires separate authorization.

**Catalog import.** `npm run catalog:import` (`Docs/catalog-import.md`) plans and applies restaurant rows for any market from a CSV or JSON file. `--test-offers` publishes test offer versions and appends an `offer.test_mark` audit row (`is_test: true`). `--withdraw-test-offers` removes versions marked that way, and versions whose older `offer.publish` metadata has `is_test: true`. That path is test supply only. It is not partner terms. No ZIP column was added. The 2026-11-02 hosted print in §1 and §3 is that test supply: `result=PASS (all supply) 192/192` is not a gate result, and `real_supply_result=FAIL 0/192`. **Master E02 is open. Master E04 is open.** This doc does not claim the D2=B gate passed.

**Hosted schema.** Forward migration `20261011210000_e02_independent_credit_floor.sql` is applied on hosted project `yiajoycgiyxjvznndjge`; migration history is reconciled.

**CI audit / deps (pending Noah's decision).** `main` includes `fix(ci)` (`cbecae2`): `npm audit --audit-level=high --omit=dev`, overrides for `sharp` and `source-map-js`. Whether that policy stays is Noah's call; this plan does not re-edit CI or lockfiles.

## 1. Draft criteria and the supply gate

### Draft master E02 criteria (for Noah to confirm)

This numbered list is a **draft**, taken only from merged PR bodies #42–#52 and `Docs/`. It is not the master list. [#43](https://github.com/noahjdevine/wanderbite/pull/43) is E03. [#49](https://github.com/noahjdevine/wanderbite/pull/49) only retargets the CI Postgres image.

1. Offer binding, per-credit floor (1000-cent lowest tier; Noah 2026-10-10 supersedes pair `base_sum >= 2000`), publish-time refusal via `offer_version_terms_ok` / `publish_offer_version`, 840-hour deadline, capacity. Landed [#42](https://github.com/noahjdevine/wanderbite/pull/42); forward migration `e02_independent_credit_floor`. `supabase/tests/e02-capacity-binding.sql`, `supabase/tests/e01-offer-versions.sql` (publish floor).
2. Inactive ledger; `workflow_version` defaults to `legacy`. Landed. [#44](https://github.com/noahjdevine/wanderbite/pull/44). `supabase/tests/e02-b-credits.sql`.
3. Daily catch-up and shared last seat. Landed. [#45](https://github.com/noahjdevine/wanderbite/pull/45). `scripts/e02-remainder-catchup.ts`, `scripts/e02-remainder-shared-seat.ts`, `src/lib/challenges/issue-credit-catchup.test.ts`.
4. Rollover of older pending credits. Landed. [#46](https://github.com/noahjdevine/wanderbite/pull/46). `scripts/e02-rollover.ts`, `src/lib/challenges/rollover-credits.test.ts`.
5. `assign_carried_credit` (same 1000-cent per-credit floor as other assignment paths). Landed. [#47](https://github.com/noahjdevine/wanderbite/pull/47). `supabase/tests/e02-assign-carried-credit.sql`.
6. One linked-credit swap per America/Chicago month. Landed. [#48](https://github.com/noahjdevine/wanderbite/pull/48). `supabase/tests/e02-credit-safe-swaps.sql`.
7. Carried credits on `/challenges`. Landed. [#50](https://github.com/noahjdevine/wanderbite/pull/50). `src/lib/challenges/carried-credits.test.ts`, `src/lib/challenges/assign-carried-credit.test.ts`.
8. Cohort fixture printing `match 10/12`. Landed fixture only, not the gate. [#51](https://github.com/noahjdevine/wanderbite/pull/51). `supabase/tests/e02-six-month-cohort.sql`.
9. Supply simulation on synthetic configs. Landed; gate stays open. [#52](https://github.com/noahjdevine/wanderbite/pull/52). `src/lib/challenges/supply-simulation.test.ts`, `scripts/e02-supply-simulation.ts`.
10. `subYears(now, 12)` removed from swap and variety. **Landed.** [#55](https://github.com/noahjdevine/wanderbite/pull/55). `src/lib/challenges/restaurant-safety.test.ts`. `swap-challenge.ts` and `generate.ts` do not reference `subYears`. Variety lookbacks use `varietyCycleMonthLowerBound`. Redemption cooldown uses `redemptionCooldownOk` / `redemptionCooldownReason`.
11. A real profile on `credits`. **Not an automatic E02 prerequisite.** Real-member cutover requires separate authorization. Those PRs forbid the cutover. Hosted count in §2 is 0. **After credits cutover: build E04 carried-credit reveal next.** Noah decided this on 2026-11-03: that reveal is the first slice immediately after the real-member credits cutover, not before.
12. Master E02 acceptance stays **open**. **Master E04 is open.** The table under Master E04 acceptance is test evidence from #85, not sign-off. E04 acceptance stays open until Noah confirms.

**D1. Adopt this draft?** A) Noah pastes the original list and this draft is retired. B) Accept this draft as the master list. C) Keep it unofficial until a later confirmation. **Recommended, needs Noah: C.**

### Decision: six-month supply gate

[#51](https://github.com/noahjdevine/wanderbite/pull/51) says cohort `match 10/12` is not this gate. [#52](https://github.com/noahjdevine/wanderbite/pull/52) says the selector still does not close it.

**Metric.** `src/lib/challenges/supply-simulation.ts` line 747 counts credits with `challengeItemId !== null`; line 760 sets `denominator` to `ledger.credits.length`. `baseConfig` `ks` is `[5, 4, 3, 2, 1, 0]` (line 209); each `k` uses `chicagoMonthStart` (line 488) and `issueTwoCredits` (line 495). `COVERAGE_CONFIG` (line 219) keeps those six months. Do not use `seededMatchRate` (lines 841–849). `tight_ceiling` overrides `ks` to `[0]` (line 227).

**Catalog.** A) The 29 synthetic `SUPPLY_RESTAURANTS` (lines 116–135: 12 `S*` rows plus keys `U1` through `Far2`). B) Superseded 2026-10-01: D2=B is a read-only hosted snapshot saved as gitignored JSON, not a catalog loaded into disposable Docker. C) Both. Catalog A remains the logic regression only.

**Threshold.** Superseded 2026-10-01 by D2=B below: 100% of credits over 6 Chicago months, every seeded trial. The earlier recommendation was catalog A with `numerator === denominator` on `COVERAGE_CONFIG`. [#52](https://github.com/noahjdevine/wanderbite/pull/52) printed `simulated_match=12/12` for coverage. That print is not a pass of this gate. The D2 gate stays open.

**Run and record.** `npm test` (`src/lib/challenges/supply-simulation.test.ts`) and `npm run test:db` (`scripts/e02-supply-simulation.ts` via `scripts/test-database.ts`) print `simulated_match=` (`formatSupplySimulationReport`, line 940). Paste that line. No `db push`. B or C needs a loader that does not write hosted data.

**Determinism.** The simulation sorts with `byId` (line 360; lines 576 and 605). Production `generate.ts` shuffles with `randomInt` (lines 171–175) at line 527. A gate pass does not fix a member’s draw.

**D2. Gate score?** A) Catalog A, `numerator === denominator` on `COVERAGE_CONFIG`. B) Catalog B with a threshold Noah names. C) Both must pass. **Decided by Noah 2026-10-01: B, hosted active snapshot, threshold 100% of credits issued over 6 Chicago months, every seeded trial.**

### Supply gate (D2=B)

Catalog A (`SUPPLY_RESTAURANTS`, criterion 9) stays the logic regression. It is not this gate. The #51 SQL cohort is not this gate.

**Metric.** Denominator is 16 members × 6 Chicago months × 2 credits = 192. Numerator is those credits with `challengeItemId !== null` at the end of M5. A carry match counts in the numerator and is reported `matched_via_carry`. Do not use `seededMatchRate`. PASS only when numerator === denominator in every seeded trial. One unmatched credit is FAIL.

**Cohort.** `SUPPLY_GATE_COHORT`: 4 launch ZIPs (75069, 75070, 75071, 75072) × open/restricted × new/tenured. Open has no flags. Restricted uses `MEMBER_FLAGS` (vegan, peanut, italian) and counts toward 100% unless Noah later makes that persona report-only. Distance band `5_mi`, no cocktail reserve, no swaps, completion `verify_on_assign`. Tenured members get 6 unscored warm-up months (M−6..M−1, ks 11..6) on a private capacity table with offer-validity checks off. Warm-up seeds redemptions and cycles only.

**Window.** M0 is the first Chicago month whose simulated 15th 18:00Z is at or after the snapshot `exported_at`. Score M0..M5. Each month: `applyRollover` after the member’s first month, `issueTwoCredits`, carried assign (lowest tier >= 1000 cents), then link two distinct eligible restaurants.

**Trials.** Default 20, seeds 1..N, mulberry32 shuffle. `--seed` repeats one trial. Never `Math.random`.

**Funnel.** First failing rule on the full active catalog: outside_market, no_offer_version (legacy offers are diagnostic only; `legacy_offer_only`), offer_version_not_selectable (`offerVersionCoversDeadline`: not_yet_valid, expires_before_deadline, withdrawn), offer_tiers_invalid, missing_coordinates, dietary_exclusion, allergy, excluded_cuisine, cooldown_recent_visit_6m, cooldown_two_in_12m, capacity_full, variety_6m, variety_12m, relaxed_variety_last_month, then outside_distance at the radius actually used, then `below_floor` when fewer than the needed count of distinct restaurants meet the 1000-cent lowest-tier minimum. Variety uses `varietyCycleMonthLowerBound(now, 6|12)` with `cycle_month >= bound` and `< chicagoMonthStart(now)`. Redemption cooldown stays rolling (`redemptionCooldownReason` / `redemptionCooldownOk`). Each failing line also prints survivor counts: active, market, offer_version, selectable, coords, dietary, allergy, cuisine, cooldown, capacity, distance, variety, floor, need, binding.

**Offer versions.** A restaurant is selectable only with a current offer version that passes the same window as `version_selection_ok` (`20260925175518`) and that `link_pending_credits` (`20260925215534`) requires. Legacy `restaurant_offers` do not make a restaurant eligible. Per-credit floor: each restaurant’s `offer_lowest_tier_cents` must be >= `credit_floor_cents()` (1000); carried and pair linking evaluate each credit independently.

**Floor-aware selector (Noah 2026-10-10).** No production caller of `link_pending_credits` exists under `src/` (the SQL function receives the pair; it does not choose it). The gate uses `selectDistancePool` with `poolHasDistinctCreditFloorEligible`: strict variety, then relaxed variety, then at most one larger distance band until two distinct eligible restaurant IDs exist. Carried credits use the same 1000-cent filter. A gate PASS measures supply under this policy. Live `generate.ts` applies the same per-credit filter before `pickDistinctRestaurants` and can receive `below_floor` from the RPC. It also drops version-bound restaurants that fail selectability or lack a free seat in any `reserve_version_buckets` month from assignment through now+840h (`src/lib/offers/version-capacity.ts`, mirroring `version_selection_ok` / `reserve_version_buckets` in `20260925175518`) before `selectDistancePool` / `pickDistinctRestaurants`. SQL enforces those version-bound checks. SQL does not enforce legacy `max_redemptions_per_month`; that cap stays TS-only. A race where the TypeScript read still shows a free seat and the RPC returns `capacity_full` keeps that existing error path. Production reuse must preserve `restaurant_base_cents` semantics: use the referenced current offer version when `current_offer_version_id` is set, with no legacy fallback when that version is missing or invalid; only when no current version is referenced, use the first active legacy offer ordered by id when `0 < discount <= minimum spend`. The RPC stays authoritative.

**How Noah runs it.** Step 0: in the Supabase SQL editor, open `scripts/sql/e02-supply-preflight.sql`, highlight only the `select` statement, and use "Run selected". Copy only the single cell. Do not use "Export as JSON". If `string_true_test_markers.count` is greater than 0, stop and report that cell. Do not hand-edit hosted rows. If that count is 0, continue. An agent or CI must not run this SQL against the hosted project. Then open `scripts/sql/e02-supply-snapshot.sql`, highlight only the `select` statement, and use "Run selected" (the editor shows only the last statement's result). Copy only the single cell value. Do not use "Export as JSON"; that wraps the cell in `[{"snapshot":...}]`. Save the cell to `.supply-gate/hosted-catalog.json` (gitignored). psql alternative for the snapshot: `psql -qAt -f scripts/sql/e02-supply-snapshot.sql > .supply-gate/hosted-catalog.json`. Then `npm run supply:gate`. Paste `result`, `real_supply_result`, `test_supply`, `unmatched_by_month`, `unmatched_by_rule`, and every `shortfall` line. When `test_supply selectable` is greater than 0, also paste `real_unmatched_by_month`, `real_unmatched_by_persona`, and every `real_shortfall` line. Those lines are the test-excluded run. The unlabeled month, persona, and shortfall lines include test supply; the report marks them with `full_run_diagnostics include test supply`. Full-run shortfall that includes test supply is not a recruiting target. Never paste or commit the snapshot.

The snapshot schema is `wanderbite.e02.supply_snapshot.v2`. `test_offer_version_ids` lists current offer versions of active restaurants that have an `offer.test_mark` audit row, or a legacy `offer.publish` row whose metadata `is_test` is JSON boolean true (`(metadata->'is_test') = 'true'::jsonb`, the same rule as `isTestOfferAuditMarker`). A JSON string `"true"` is not a test mark. (`026_admin_audit_log.sql`: `target_id` text, `metadata` jsonb.) The gate runs the full catalog and again with those versions treated as `no_offer_version`. `result=` is the full catalog. `(all supply)` is printed on that line only when `test_supply selectable` is greater than 0. A test version that is linked but not selectable does not add the qualifier or the `real_*` diagnostic lines. When selectable test supply is greater than 0, the report adds `real_unmatched_by_month`, `real_unmatched_by_persona`, and `real_shortfall` from the test-excluded run, and labels the full-run month, persona, and shortfall lines as including test supply. `real_supply_result=` is the run with test versions excluded. A PASS on `result=` while `test_supply` shows selectable test versions is not a gate result. For a v2 snapshot the process exit code follows `real_supply_result` (so test-only supply cannot exit 0). A v1 snapshot still loads, prints `test_supply=unknown (v1 snapshot)`, and keeps the previous exit code. **Master E02 is open. Master E04 is open.**

**Checklist status (synced 2026-11-03).** D2=B tooling is landed. The hosted measurement below is recorded as **test supply**. The D2=B gate is **not passed**. Master E02 is open. Master E04 is open.

**Checklist.** Six-month supply gate (D2=B): built in [#56](https://github.com/noahjdevine/wanderbite/pull/56), corrected in [#57](https://github.com/noahjdevine/wanderbite/pull/57). Live `generate.ts` now pre-filters version-bound restaurants on selectability and bucket capacity before the pick; the RPC remains authoritative. Catalog import can publish test-only offer versions so that pre-filter and this gate can be exercised. The gate now reports that test supply separately: paste `real_supply_result` with `result` and `test_supply`. A PASS on `result=` that includes test versions is not a gate result, and a v2 exit code follows `real_supply_result`. When `test_supply selectable` is greater than 0, paste `real_unmatched_by_month`, `real_unmatched_by_persona`, and every `real_shortfall` line. Those are the test-excluded run and are the recruiting target. Full-run `shortfall` lines that include test supply are not a recruiting target. `(all supply)` appears only when that selectable count is greater than 0. Gate tooling includes the read-only preflight `scripts/sql/e02-supply-preflight.sql`: run it before the snapshot and stop if `string_true_test_markers.count` is greater than 0. Hosted measurement, reported by Noah for the 2026-11-02 run at about 7:49 PM America/Chicago (not re-run for this doc; market `mckinney-tx`): snapshot v2 plus `npm run supply:gate` printed `result=PASS (all supply) 192/192` and `real_supply_result=FAIL 0/192`. That `result=PASS` line is all supply, including the `--test-offers` versions. It is not a gate result. Real supply means real partner offer versions per launch ZIP (75069, 75070, 75071, 75072). Noah reports no real partner offers yet, so the D2=B gate is not passed. The git revision of that print, and any `test_supply`, `unmatched_by_month`, `unmatched_by_rule`, `shortfall`, `real_unmatched_by_month`, `real_unmatched_by_persona`, or `real_shortfall` lines from it, were not pasted here and are **unknown**. This measurement is an outstanding hosted result (`real_supply_result=FAIL 0/192` on test supply). This doc does not predict it. Criterion 11 (a real profile on `credits`) stays separate from this gate and is not an automatic E02 prerequisite; real-member cutover requires separate authorization. After credits cutover: build E04 carried-credit reveal next (Noah, 2026-11-03; the first slice after that cutover, not before). [#52](https://github.com/noahjdevine/wanderbite/pull/52)’s configurable simulation remains required coverage (swaps, spending ceilings, delayed completion, rollover, capacity utilization, required customer spend); the fixed-cohort gate does not replace it. Master E02 is open. Master E04 is open. This doc does not claim the gate passed and does not claim E02 or E04 acceptance.

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

**Catalog after the 2026-11-02 hosted run, as reported by Noah** (about 7:49 PM America/Chicago). Not re-queried for this doc. Market `mckinney-tx`. `catalog:import --apply` made 40 actions: 17 coordinate fills and 23 test offer versions (`--test-offers`). `hutchins-bbq-2` was paused as the duplicate of `hutchins-bbq` (`--resolve-duplicate keep=hutchins-bbq drop=hutchins-bbq-2`). Data is test-only by Noah’s decision. Real restaurants and real partner offers are added only when the site is launch-ready. Test offers must be withdrawn (`--withdraw-test-offers`) before a real launch. The 2026-10-01 status counts above were not re-run; the hosted active-restaurant count after that pause is **unknown**. The same run’s supply-gate print is in §1 and §3: `result=PASS (all supply) 192/192` includes test supply and is not a gate result; `real_supply_result=FAIL 0/192`. The step-2b `--plan` duplicate described in §5 is closed.

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

**Next measurement.** Gate tooling landed in [#56](https://github.com/noahjdevine/wanderbite/pull/56) and [#57](https://github.com/noahjdevine/wanderbite/pull/57), and the v2 test-supply split is on `main` through [#68](https://github.com/noahjdevine/wanderbite/pull/68), [#69](https://github.com/noahjdevine/wanderbite/pull/69), and [#70](https://github.com/noahjdevine/wanderbite/pull/70). Noah’s hosted run on 2026-11-02 at about 7:49 PM America/Chicago (not re-run for this doc) used snapshot v2 plus `npm run supply:gate` and printed `result=PASS (all supply) 192/192` and `real_supply_result=FAIL 0/192`. `result=PASS (all supply)` is the all-supply line, including test offer versions. It is not a gate result. Real supply means real partner offer versions per launch ZIP. With no real partner offers yet, the D2=B gate is not passed. The checkout SHA for that print is **unknown**, and the other paste lines from §1 (`test_supply`, month, rule, and shortfall, including `real_*`) were not included in this report and are **unknown**. Master E02 is open. Master E04 is open. The D2=B print above is an outstanding hosted measurement (`real_supply_result=FAIL 0/192` on test supply). This doc does not predict it.

**Expiry clocks (do not conflate).** Keep three clocks separate: redemption token `redemptions.expires_at` (issued QR lifetime), `challenge_items.redemption_deadline` (visit window on the assignment), and `entitlement_credits.expires_at` (credit shelf life). A **version-backed** assignment sets `redemption_deadline` to assignment time plus **840 hours** (`now() + interval '840 hours'` in the assignment RPCs). **Carried-credit** `assign_carried_credit` and **credit-safe** `swap_linked_credit_item` cap that deadline with `least(now() + interval '840 hours', entitlement_credits.expires_at)` (and carried paths may use the credit’s T2 expiry when linking rolls forward). Do not treat one field as the others.

**Out of scope.** Credits cutover, `db push`, `types:db`, new packages, supply simulation, E04, SQL cooldown inside the RPCs, `stripe.exe`, G13-B, SEC-14, checkout, AI ceilings, marking E02 or E04 complete.

## 4. Doc drift

Applied in this docs-only sync. No product behavior change.

`.cursor/rules/project-context.mdc` now follows `supabase/migrations`: `challenge_cycles` (not `challenges`), `challenge_items.cycle_id`, `restaurant_offers` columns as migrated (`discount_amount_cents`, `min_spend_cents`, `max_redemptions_per_month`, `active`; no `discount_cents` or `valid_from`), `redemptions.user_id` and `verified_at`, plus `entitlement_credits`, `offer_versions`, and `user_profiles.workflow_version` (`legacy` default, or `credits`). `user_profiles` and `user_preferences` stay. The verify-and-correct warning is removed. Business rules cite sealed tiers and the 1000-cent per-credit floor (Noah 2026-10-10; [#42](https://github.com/noahjdevine/wanderbite/pull/42) history), the assignment deadline as implemented ([#42](https://github.com/noahjdevine/wanderbite/pull/42)), one linked-credit swap per Chicago month ([#48](https://github.com/noahjdevine/wanderbite/pull/48)), `redemptionCooldownOk`, and `varietyCycleMonthLowerBound`. The D2 command `npm run supply:gate` is named. No hosted gate result is claimed. Live `generate.ts` filters to restaurants whose `restaurant_base_cents` meets the per-credit floor before `pickDistinctRestaurants`; the assignment RPC remains authoritative for `below_floor`. Members are not described as being on credits. Publish-time refusal for sub-floor tiers is enforced in SQL/app (this plan and tests); it is not claimed as text inside `project-context.mdc`.

`.cursor/rules/conventions.mdc` rule 1 allows `cursor/*` branch names alongside `fix/<short-description>` (naming only). Rule 4 still waits for confirmation before `db push`, and notes that hand-edited types ([#39](https://github.com/noahjdevine/wanderbite/pull/39), [#41](https://github.com/noahjdevine/wanderbite/pull/41), [#46](https://github.com/noahjdevine/wanderbite/pull/46), [#47](https://github.com/noahjdevine/wanderbite/pull/47)) need a separate approved `types:db` PR. Push, package, and spending rules are unchanged.

[#64](https://github.com/noahjdevine/wanderbite/pull/64) (`db1b34e64b5e3661757e471507165fe6704b747c`) moved roulette excluded cuisines onto `useSyncExternalStore`. On that commit the reader returned a new array every call (`return []` and `normalizeCuisineIds`), which looped `/roulette` with “The result of getSnapshot should be cached” and “Maximum update depth exceeded”. [#65](https://github.com/noahjdevine/wanderbite/pull/65) (`be56b9400ad14d3f0d5dd37a92b323f8a490eabe`) caches that snapshot in `src/lib/excluded-cuisines-store.ts` by the raw `wb_excluded_cuisines` string and shares one frozen empty array for missing or invalid storage and the server snapshot.

[#72](https://github.com/noahjdevine/wanderbite/pull/72) (merge `a1c651c53f510c8eef293a35b276313ce194e8e0`) keeps an active member (`subscription_status = 'active'`) on `/challenges` from sign-in and from `/onboarding`, including when username or address is unfinished. `/account` stays put for that member. Server-side launch eligibility goes through `resolveStructuredAddress` and `launchAreaState` in `src/lib/launch-market.ts`. Structured street, city, state, and ZIP win when all four are set. The strict legacy single-line address (`street, city, ST ZIP`) counts only when all four structured fields are blank. A partial structured row is not merged with the legacy line.

`Docs/build-kit.md` §3 and the §4 issuance line now describe the sealed-tier per-credit floor (1000 cents), the Chicago-month credit swap, `redemptionCooldownOk`, and the traced expiry clocks. Other build-kit sections are unchanged.

## 5. Risks and the remaining decisions

Review speed, from `gh pr view` `createdAt` / `mergedAt`: [#50](https://github.com/noahjdevine/wanderbite/pull/50) opened 2026-09-29T22:45:27Z and merged 2026-09-29T22:48:05Z (about 3 minutes); [#51](https://github.com/noahjdevine/wanderbite/pull/51) 2026-09-30T00:03:18Z to 2026-09-30T00:12:42Z (about 9 minutes); [#41](https://github.com/noahjdevine/wanderbite/pull/41) 2026-09-25T01:30:00Z to 2026-09-25T01:36:30Z (about 6 minutes). Proposed: a migration or RPC PR records its checklist in the body before merge.

Hand-edited `src/types/database.types.ts` can drift from the hosted schema confirmed in §2 until the `types:db` PR lands.

Legacy `startOfMonth` versus `chicagoMonthStart` is an open cutover item, not this slice. `generate.ts` builds `utcCycleMonthStr` with `startOfMonth` (line 272), looks up both month keys (lines 273–275), and writes `p_cycle_month` as Chicago only when the pair is version-backed (line 545). Legacy swap capacity uses `startOfMonth` (lines 550–551). A legacy-to-credits cutover can split one calendar month across two `cycle_month` values.

`Docs/g13-b-hosted-evidence.md` still has the onboarding `permission denied for table user_profiles` note, and G13-B’s checklist there is open. SEC-14 (`Docs/g14-sec-14.md`) still needs the Auth dashboard. `stripe.exe` is the tracked 31,689,728-byte blob from `3cc5256`. This plan did not execute it. [#55](https://github.com/noahjdevine/wanderbite/pull/55) merged: `subYears` is gone from `swap-challenge.ts` and `generate.ts`. The credit RPCs still do not apply `redemptionCooldownOk`.

On 2026-11-02 the step-2b `catalog:import --plan` run was rejected on the `hutchins-bbq` / `hutchins-bbq-2` duplicate pair (shared `google_place_id`) before `--resolve-duplicate` took effect. `hutchins-bbq-2` was later paused (`keep=hutchins-bbq`, `drop=hutchins-bbq-2`). Closed 2026-11-03: Noah deleted `hutchins-bbq-2` and its one `restaurant_offers` row. Reported, not re-queried.

Test offers must be withdrawn (`catalog:import --withdraw-test-offers`) before a real launch. Noah’s decision for this hosted data: it stays test-only, and real restaurants and real partner offers are added only when the site is launch-ready. The 2026-11-02 `result=PASS (all supply) 192/192` includes those test versions and is not a D2=B pass.

**D4. Where may `workflow_version` become `credits`?** A) Disposable Docker only. B) One disposable hosted user. C) Not in the cooldown PR or the gate run. **Recommended, needs Noah: C for now, then A.** This plan does not change it.

**D5. Onboarding `user_profiles` insert next?** A) The slice after the cooldown fix. B) Stay parked. C) Fold it into a G13-B evidence PR. **Recommended, needs Noah: B.**

**D6. G13-B and SEC-14?** A) Noah re-checks the open G13-B boxes and the four Auth settings. B) Close them from the repo. C) Defer both. **Recommended, needs Noah: A.** Current dashboard values are **unknown**.

**D7. `stripe.exe`?** A) Remove it in a separate PR. B) Keep it. C) Gitignore it and document how to install the CLI. **Recommended, needs Noah: A.**
