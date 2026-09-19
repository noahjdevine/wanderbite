# G13-A1 — AI budget contract (decision record)

Owner: **Noah** until reassigned.

This group ships the **ledger only**: an immutable database price registry, reservation state machine, atomic RPCs, and grants/RLS. Roulette, Redis, cookies, Anthropic HTTP, and G13-B are **G13-A2+**. Do not treat this document as live metering until A2 is merged.

`CHECKOUT_ENABLED` stays fail-closed. Approved product features and allowances are not reduced here.

## Approved (product)

| Item | Value |
| --- | --- |
| Paid account ceiling | **$1.00** internal AI cost per America/Chicago calendar month |
| Signed-in free ceiling | **$0.20** internal AI cost per America/Chicago calendar month |
| Customer charge | These are **not** extra customer fees. They are internal cost allowances. |
| Month key | `America/Chicago` (`YYYY-MM`) from the bound config timezone |
| Customer vs platform | Displayed customer allowance is **not** actual/platform expense |
| Credits / QR / billing | Never depend on remaining AI allowance |

Upgrade in-month raises the ceiling to **$1.00 total**, not $1.20. Downgrade follows authoritative paid-access expiry (`user_profiles.subscription_status`) and **does not erase** accrued usage.

## Proposed operating defaults (configurable, not promises)

Stored on `ai_budget_config_versions` (new version to change; never update a published row):

| Item | Default | Microdollars |
| --- | --- | --- |
| Paid protected-core share | $0.40 of the $1.00 | 400_000 |
| Paid optional share | $0.60 of the $1.00 | 600_000 |
| Guest session ceiling | $0.02 | 20_000 |
| Guest session AI turns | 3 (upper bound; cost may stop earlier) | — |
| Guest voice seconds | 30 | — |
| Guest shared day pool | $5 | 5_000_000 |
| Guest shared month pool | $50 | 50_000_000 |
| Platform global cap | $100 (includes sublimits below) | 100_000_000 |
| Catalog maintenance sublimit | $10 | 10_000_000 |
| Global paid-core reserve | $20 so optional/free/guest/maintenance cannot spend the last platform dollars first | 20_000_000 |

Roulette (A2) is **optional** for signed-in users and **guest** for anonymous preview. It must not draw per-account protected-core or the global paid-core reserve.

## Units and arithmetic

- Store **integer microdollars** (`$1 = 1_000_000`).
- Store rates as **microdollars per million units**.
- Cost = integer ceiling: `(units * rate + 999_999) / 1_000_000`.
- The **database price registry is authoritative**. TypeScript must call `ai_quote_max_cost` and must not duplicate provider rates.

## Seeded Haiku 4.5 snapshot (registry only)

Pinned model id for A2: `claude-haiku-4-5-20251001` (Anthropic snapshot, not the moving alias).

Published Anthropic standard rates seeded as version 1 (verify before changing; new version required):

| usage_kind | USD / MTok | microdollars_per_million |
| --- | --- | --- |
| input | $1.00 | 1_000_000 |
| output | $5.00 | 5_000_000 |
| cache_write_5m | $1.25 | 1_250_000 |
| cache_write_1h | $2.00 | 2_000_000 |
| cache_read | $0.10 | 100_000 |

Unknown usage kinds with positive units **fail closed** (no invented rate). Tool tokens are quoted only when they appear as a priced `usage_kind` already in the registry.

## Request state machine

`denied` → `reserved` → `dispatched` → `settled`  
exits: `failed_before_dispatch`, `assumed_spent`

| Status | Customer allowance | Platform expense | Provider call |
| --- | --- | --- | --- |
| `denied` | none | none | no |
| `reserved` | held | held | no |
| `dispatched` | held | held | **one** `ai_dispatch` owner (`acquired = true`) |
| `settled` | actual successful use | actual | already happened |
| `failed_before_dispatch` | released | released | never sent |
| `assumed_spent` | held, then **released** via `ai_release_customer_allowance` | conservative hold until `ai_reconcile` | unknown / timed out |

Replay of `ai_dispatch` after the first acquisition returns `acquired = false` and must not launch a second provider call.

Each reservation binds immutable `provider`, `model_id`, `price_version_id`, and `config_version_id`.

## Atomic buckets

A reserve must pass **every applicable** bucket in one transaction:

- Account month (paid $1.00 / free $0.20 from server `subscription_status`)
- Paid protected and/or optional shares
- Guest session / day / month
- Maintenance (maintenance class only)
- Global platform cap
- Global paid-core reserve **floor**: non-core classes cannot consume the reserved slice

Optional/free/guest/maintenance cannot label themselves `protected_core`.

## Grants / RLS

Tables: RLS enabled, **no** client policies. `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`, and `service_role` (no table DML, including service role).

RPCs: `SECURITY DEFINER` with `search_path` `pg_catalog, public`. `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`. `GRANT EXECUTE` to `service_role` only.

## Remote schema

Do **not** apply this migration until authorized. `npm run types:db` targets the remote project and must not be used to invent local types. Local proof is `npm run test:db` against the disposable schema contract.

After an authorized push:

```text
npx supabase db push --linked --yes
```

Then regenerate types and diff them against the checked-in `src/types/database.types.ts`.

## G13-A2 (metered roulette)

Roulette is **optional** for signed-in users and **guest** for anonymous preview. It must not draw per-account protected-core or the global paid-core reserve.

Pinned model: `claude-haiku-4-5-20251001`. HTTP idempotency is `roulette:{subject}:{uuid}` with one provider fetch only when both `ai_reserve.acquired` and `ai_dispatch.acquired` are true. Replay returns the stored `result_payload` or an honest `selectionMode: "random_fallback"` — never a second Anthropic call.

Auth-callback guest transfer is **best-effort** and must not break login.

### Rollout / rollback

Preview and production start with **`WANDERBITE_AI_DISABLED=true`**. Enable billable AI only after fallback, secret, Redis, replay, timeout, transfer, and stale-recovery tests pass. Rollback is this kill switch, not unmetered roulette.

Do **not** apply the A2 migration until authorized:

```text
npx supabase db push --linked --yes
```

Then `npm run types:db` and diff `src/types/database.types.ts`.

`CHECKOUT_ENABLED` stays fail-closed. Approved $1.00 / $0.20 ceilings are unchanged.

## Rollback

If the A1 migration was never pushed, revert that PR. If it was pushed and A2 is not live, leave unused tables in place; do not drop blindly. If A2 is live, set `WANDERBITE_AI_DISABLED=true` — do not serve unmetered Claude.
