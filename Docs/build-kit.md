# WANDERBITE BUILD KIT

> **Full spec:** See `Build Kit.pdf` (or project root `Build Kit and Tech Stack/`) for RBAC, UI requirements, test plan, delivery plan, and first-build checklist.

## 1. System Goals
- User subscribes ($15/mo) → receives 2 assigned restaurant challenges per month.
- Restaurant-funded offer: $10 off when spend >= $40.
- Guardrails: Random assignment, Max 2 redemptions/restaurant/year, 6-month cooldown.
- Gamification: Points, Badges, Raffles.

## 2. Data Model (Postgres/Supabase)
### Core Tables (aligned with implemented schema)
- **markets**: id, name, timezone, status
- **restaurant_orgs**: id, name, market_id
- **restaurants**: id, org_id, market_id, name, cuisine_tags, address, lat, lon, location (PostGIS), status
- **restaurant_offers**: id, restaurant_id, discount_amount_cents, min_spend_cents, max_redemptions_per_month, active
- **user_profiles**: id (→ auth.users), email, role, dietary_flags, allergy_flags, distance_band, …
- **user_preferences**: user_id (→ user_profiles), excluded_cuisines
- **challenge_cycles**: id, user_id, cycle_month, status, swap_count_used
- **challenge_items**: id, cycle_id, restaurant_id, slot_number, status (assigned/swapped_out/redeemed), swapped_from_item_id
- **redemptions**: id, user_id, restaurant_id, challenge_item_id, token_hash, status, verified_at

## 3. Assignment Engine Spec
### Eligibility Filters (Must-Pass)
1. **Subscription:** Status = active.
2. **Safety:** Exclude if restaurant tags match user allergy_flags.
3. **Cooldowns:** `redemptionCooldownOk` / `redemptionCooldownReason` (`src/lib/challenges/restaurant-safety.ts`). Cutoffs are America/Chicago wall-clock months via `subMonthsChicago`: a nonexistent spring-forward wall time resolves to the transition instant; an ambiguous fall-back resolves to the earlier occurrence; while `now` is inside the repeated hour, the cutoff holds at one millisecond before the backward transition.
   - One verified visit at or after the six-month cutoff blocks.
   - Two verified visits at or after the twelve-month cutoff block.
   - Variety is separate: `varietyCycleMonthLowerBound` (full Chicago calendar months).
4. **Offer and pair floor:** Sealed `offer_versions` tiers. A pair must sum lowest-tier bases to at least 2000 cents. SQL `restaurant_base_cents` is authoritative. Live `generate.ts` still picks two candidates with `pickDistinctRestaurants` and can receive `pair_below_floor`.
5. **Capacity:** Restaurant monthly redemptions < max_redemptions_per_month on the legacy offer path. Version-backed capacity is reserved in SQL from the published offer version.

### Swap Logic
- Linked credits: one swap per America/Chicago month (`credit_swap_allowances`). That path does not increment `swap_count_used`.
- Legacy `swap_challenge_item` still increments `swap_count_used` from 0 to 1 on the cycle.
- Mark old item `swapped_out`.
- Generate replacement using the same hard filters.
- Carried successor deadline (`swap_linked_credit_item`): `least(now + 840 hours, credit.expires_at)` when that instant is still after now; otherwise `least(source.redemption_deadline, now + 840 hours)`.

## 4. API Contract (Next.js / Server Actions)
- `GET /v1/challenges/current`: Returns current month's 2 challenge cards.
- `POST /v1/challenges/swap`: Swaps a specific item (if eligible; uses same eligibility filters).
- `POST /v1/redemptions/issue`: Issues a redemption code. Three clocks, which can differ across DST:
  - **Code expiry when the item has no `redemption_deadline`:** `redemptionExpiresAt` (`src/lib/redemption-expiry.ts`) is `addDays(from, 35)` (35 calendar days, process-local). `issue_challenge_redemption` stores that `p_expires_at` unless a deadline overwrites it. The column default is `now() + interval '35 days'`. `verify_redemption` requires `expires_at > now()` and does not recompute the span. The expire cron's legacy cutoff is `subDays(now, 35)` on `created_at`, and it skips items that have `redemption_deadline`. Process-local calendar days and Postgres `interval '35 days'` can land on different instants when a DST transition falls in the window or the process timezone differs from the database session TimeZone. The exact hour delta was not measured here.
  - **Assignment deadline:** When an offer version is bound, `challenge_items.redemption_deadline` is `v_now + interval '840 hours'` (`20260925175518_e02_capacity_binding.sql`). A null version stores a null deadline. `version_selection_ok` requires `valid_until > p_at + interval '840 hours'`. If `redemption_deadline` is set, `issue_challenge_redemption` rejects issuance at or after it and stores `expires_at` as that deadline, not the 35-day helper. Due version-bound items go through `expire_version_bound_assignment`. 840 hours is a fixed duration.
  - **Carried assignments, capped by credit expiry:** `assign_carried_credit` sets the deadline to `least(v_now + interval '840 hours', credit.expires_at)`. `issue_period_credits` sets new-credit `expires_at` to `(issue_period + interval '1 month')::timestamp at time zone 'America/Chicago'`. Rollover can move that to `issue_period + interval '2 months'` at the same Chicago conversion. That civil boundary is not the same instant as 840 hours or 35 calendar days.
- `POST /v1/partner/verify`: Partner validates token; optional confirm step to mark verified.