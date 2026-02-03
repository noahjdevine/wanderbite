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
- **user_profiles**: id (→ auth.users), email, role, dietary_flags, allergy_flags, cuisine_opt_out, distance_band
- **challenge_cycles**: id, user_id, cycle_month, status, swap_count_used
- **challenge_items**: id, cycle_id, restaurant_id, slot_number, status (assigned/swapped_out/redeemed), swapped_from_item_id
- **redemptions**: id, user_id, restaurant_id, challenge_item_id, token_hash, status, verified_at

## 3. Assignment Engine Spec
### Eligibility Filters (Must-Pass)
1. **Subscription:** Status = active.
2. **Safety:** Exclude if restaurant tags match user allergy_flags.
3. **Cooldowns:** - No redemption at this restaurant in last 6 months.
   - Max 2 redemptions at this restaurant in rolling 12 months.
4. **Capacity:** Restaurant monthly redemptions < max_redemptions_per_month.

### Swap Logic
- User gets 1 swap per month.
- Increment `swap_count_used`.
- Mark old item `swapped_out`.
- Generate replacement using same eligibility filters.

## 4. API Contract (Next.js / Server Actions)
- `GET /v1/challenges/current`: Returns current month's 2 challenge cards.
- `POST /v1/challenges/swap`: Swaps a specific item (if eligible; uses same eligibility filters).
- `POST /v1/redemptions/issue`: Generates short-lived token (e.g. 30 min).
- `POST /v1/partner/verify`: Partner validates token; optional confirm step to mark verified.