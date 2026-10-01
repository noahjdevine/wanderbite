# E02 plan

Base `a47b90a` (merge of [#52](https://github.com/noahjdevine/wanderbite/pull/52)). No file in the repo is a master E02 or E04 list. **Master E02 is open. Master E04 is open.** This doc does not close either. “Landed” means the PR merged that behavior. It is not a sign-off.

## 1. Acceptance checklist

[#43](https://github.com/noahjdevine/wanderbite/pull/43) is E03 text discovery. [#49](https://github.com/noahjdevine/wanderbite/pull/49) only retargets the CI Postgres image. Neither is an E02 criterion.

| Criterion (sourced from PR bodies and `Docs/`) | Status | PR | Test |
| --- | --- | --- | --- |
| Master E02 acceptance | **open** | [#42](https://github.com/noahjdevine/wanderbite/pull/42), [#44](https://github.com/noahjdevine/wanderbite/pull/44), [#45](https://github.com/noahjdevine/wanderbite/pull/45), [#50](https://github.com/noahjdevine/wanderbite/pull/50), [#52](https://github.com/noahjdevine/wanderbite/pull/52) | No list in the repo |
| Offer binding, pair floor `base_sum >= 2000` cents, 840-hour deadline, capacity | landed | [#42](https://github.com/noahjdevine/wanderbite/pull/42) | `supabase/tests/e02-capacity-binding.sql` |
| Inactive ledger; `workflow_version` defaults to `legacy` | landed | [#44](https://github.com/noahjdevine/wanderbite/pull/44) | `supabase/tests/e02-b-credits.sql` |
| Daily catch-up and shared last seat | landed | [#45](https://github.com/noahjdevine/wanderbite/pull/45) | `scripts/e02-remainder-catchup.ts`, `scripts/e02-remainder-shared-seat.ts`, `src/lib/challenges/issue-credit-catchup.test.ts` |
| Rollover of older pending credits | landed | [#46](https://github.com/noahjdevine/wanderbite/pull/46) | `scripts/e02-rollover.ts`, `src/lib/challenges/rollover-credits.test.ts` |
| `assign_carried_credit` (2000-cent floor for that function) | landed | [#47](https://github.com/noahjdevine/wanderbite/pull/47) | `supabase/tests/e02-assign-carried-credit.sql` |
| One linked-credit swap per America/Chicago month | landed | [#48](https://github.com/noahjdevine/wanderbite/pull/48) | `supabase/tests/e02-credit-safe-swaps.sql` |
| Carried credits on `/challenges`; first assign caller | landed | [#50](https://github.com/noahjdevine/wanderbite/pull/50) | `src/lib/challenges/carried-credits.test.ts`, `src/lib/challenges/assign-carried-credit.test.ts` |
| Cohort fixture that prints `match 10/12` | landed fixture only | [#51](https://github.com/noahjdevine/wanderbite/pull/51) | `supabase/tests/e02-six-month-cohort.sql` |
| Supply simulation on synthetic configs | landed; gate stays open | [#52](https://github.com/noahjdevine/wanderbite/pull/52) | `src/lib/challenges/supply-simulation.test.ts`, `scripts/e02-supply-simulation.ts` |
| `subYears(now, 12)` still in swap and variety | **open** | [#52](https://github.com/noahjdevine/wanderbite/pull/52) follow-up | Not written |
| Real profile on `credits` | **blocked** | Those PRs forbid the cutover | Hosted count below |
| Master E04 acceptance | **open** | [#52](https://github.com/noahjdevine/wanderbite/pull/52) | None |

Rows that are not in a merged PR body or `Docs/` are **unknown**. Noah: where is the master E02 list, and which rows are missing?

### Six-month supply gate (E04 entry)

[#51](https://github.com/noahjdevine/wanderbite/pull/51) says cohort `match 10/12` is not this gate. [#52](https://github.com/noahjdevine/wanderbite/pull/52) says the selector still does not close it. The run uses the real dietary, allergy, cuisine, cooldown, ceiling, and distance helpers, then the credit RPCs, on **synthetic fixtures** in disposable Docker Postgres (`coverage`, `carry_pressure`, `tight_ceiling`, `thin_catalog`, `ceiling_expansion`). It does not read hosted restaurants.

Read-only count on `yiajoycgiyxjvznndjge` (2026-10-01): **24** rows with `status = active`, and no other status in that group-by.

**Pass/fail number: unknown.** A gate needs a named fraction and a named catalog. Do not treat coverage `simulated_match=12/12` or cohort `match 10/12` as a pass. Noah: what numerator, denominator, and catalog (those synthetic configs, or these 24 restaurants) is a pass?

## 2. Hosted migrations

`list_migrations` on `yiajoycgiyxjvznndjge`, read-only, 2026-10-01. All five are **applied**.

| Version | Name | State |
| --- | --- | --- |
| `20260925175518` | `e02_capacity_binding` | applied |
| `20260925215534` | `e02_b_credit_ledger` | applied |
| `20260927220000` | `e02_rollover_credits` | applied |
| `20260929180338` | `e02_assign_carried_credit` | applied |
| `20260929201138` | `e02_credit_safe_swaps` | applied |

`vercel.json` schedules `/api/cron/issue-credit-catchup` (`0 7 * * *`) and `/api/cron/rollover-credits` (`30 7 * * *`). Same-day aggregate: 3 `legacy`/`active`, 4 `legacy`/`inactive`, **0** `credits`. With the ledger present, both jobs snapshot an empty set.

If `20260925215534` were missing, both routes’ `workflow_version` select would throw and `runLeasedCron` would return HTTP 500. Catch-up would also miss `issue_period_credits`. If only `20260927220000` were missing, catch-up could still issue, and `rollover_credits` would throw HTTP 500 with no carry. The schedules would still fire.

## 3. Next slice

The only slice is the [#52](https://github.com/noahjdevine/wanderbite/pull/52) follow-up. It is the prerequisite for any E04 supply claim or credits cutover. This PR does not implement it.

`redemptionCooldownOk` in `src/lib/challenges/restaurant-safety.ts` already uses `subMonths(now, 12)`, and `generate.ts` `redemptionHardOk` already calls it. Still on `subYears(now, 12)`: `swap-challenge.ts` credit path (~305) and legacy path (~558), and `generate.ts` `cyclesLast12` / `passesVariety` (~275).

**Goal.** One twelve-month window, routed through `restaurant-safety.ts`.

**User-visible.** Two verified visits older than twelve months and newer than twelve years no longer block a swap. Variety no longer drops a restaurant only because it sat on two cycles in that span. No new screen.

**Files.** `src/lib/challenges/restaurant-safety.ts`, `src/app/actions/swap-challenge.ts`, `src/lib/challenges/generate.ts`, plus vitest beside the helper (current cases are in `src/lib/challenges/supply-simulation.test.ts`).

**Given / When / Then**

- Given one verified redemption 13 months ago and none newer, when either swap path or generate cooldown runs, then the twelve-month rule passes.
- Given two verified redemptions inside twelve months and none inside six, when those filters run, then the restaurant is blocked.
- Given `cyclesLast12`, when variety counts cycles, then the lower bound comes from the helper, not `subYears`.
- Given both swap paths, when they build `passesHard`, then they call `redemptionCooldownOk` and the file does not import `subYears`.

**Tests.** Vitest for the two redemption cases, plus source guards on both swap paths and `cyclesLast12`. `npm run test:db` is regression only: no new SQL. Manual, disposable users only (do not flip a real member):

1. Credits user, active subscription, market set. Two verified redemptions at 13 and 14 months. A swap may select that restaurant when other filters pass.
2. Replace them with visits at 7 and 11 months. The swap must not select it.
3. Repeat step 1 on a legacy disposable user (`swapChallengeItem`).
4. Delete both users.

**Timezones.** At `2026-10-01T00:30:00Z`, Chicago is still September (`chicagoMonthStart` = `2026-09-01`) while UTC `startOfMonth` is `2026-10-01`. Cooldown uses the instant (`verified_at >= subMonths(now, 12)`), not either key. The same `verified_at` must match at `2026-10-01T06:00:00Z`. On DST instants `2026-03-08` and `2026-11-01`, keep that inclusive cutoff. Do not convert it to Chicago wall time, and do not replace legacy `startOfMonth` cycle lookup with `chicagoMonthStart`.

**Rollback.** Revert the app commit. No new migration. Existing E02 SQL is forward-only; do not `db push`.

**Out of scope.** Credits cutover and signup. `db push`, `types:db`, new packages. Supply simulation, the cohort fixture, and E04. SQL inside `swap_linked_credit_item` or `assign_carried_credit` (they do not re-check this cooldown). Removing `stripe.exe`. Doc-drift edits. G13-B and SEC-14. Checkout flags and AI ceilings. Marking master E02 or E04 complete.

## 4. Doc drift (do not apply)

- `.cursor/rules/project-context.mdc` still shows `users.preferences_json` and a pre-credits schema. It predates `offer_versions`, `workflow_version`, the 2000-cent pair floor, and Chicago months. Proposed: rewrite from the live tables after Noah confirms names, then delete the stale warning.
- `Docs/build-kit.md` still says $10 off $40, one swap via `swap_count_used`, and a 30-minute issue token. Code seals versions, rejects pairs under 2000 cents, stores an 840-hour deadline ([#42](https://github.com/noahjdevine/wanderbite/pull/42)), and gives credits one Chicago-month swap without incrementing `swap_count_used` ([#48](https://github.com/noahjdevine/wanderbite/pull/48)). Proposed: replace those rules and point at the SQL.
- `.cursor/rules/conventions.mdc` says never `git push`, confirm before `supabase db push`, then `types:db`, and never install a package. Cloud agents push a feature branch to open a PR. They still must not `db push` or add a package without approval. Proposed: allow that push and keep the database and package stops.

## 5. Risks and questions for Noah

A green synthetic run can be mistaken for acceptance. `subYears(now, 12)` is a twelve-year block, and the credit RPCs do not re-check it. Catch-up and rollover are scheduled; migrations are applied and zero profiles are `credits`, so the snapshot stays empty until a cutover.

`Docs/g13-b-hosted-evidence.md`: the plus-alias user had no `user_profiles` row; onboarding `updatePreferences` returned `permission denied for table user_profiles`. `completeOnboarding` is unused. That file keeps this outside G13-B close. G13-B is still open (SPF/DKIM, SMTP credential, reset and partner throttles, two `/partner` logins). SEC-14 (`Docs/g14-sec-14.md`) still needs live confirmation of email verification, password protections, session lifetime, and MFA support.

`stripe.exe` is a tracked 31,689,728-byte blob at the repo root (`3cc5256`, 2026-02-02, “Final polish before launch”). This plan did not execute it.

Noah:

1. Where is the master E02 list, and which rows above are wrong or missing?
2. What fraction, on which catalog, passes the six-month supply gate?
3. Should the variety `cycle_month` bound be `format(subMonths(now, 12), 'yyyy-MM-dd')` or a Chicago month start?
4. May a later slice set `credits` only in Docker, or also on one disposable hosted user?
5. Is the onboarding `user_profiles` insert the slice after this cooldown fix?
6. Which G13-B boxes should be re-run, and what are the four SEC-14 settings today?
7. Should `stripe.exe` leave the repo?
