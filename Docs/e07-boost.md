# E07 Boost quote and arrival sessions

E07-A1 is a pure quote. E07-A2 (arrival sessions) is design only. This PR does not add a table, RPC, page, flag, or hosted write. Members and partners see nothing new. Nothing imports `src/lib/boost/quote.ts` from `src/app`.

## E07-A1 quote

`quoteBoost` in `src/lib/boost/quote.ts` takes sealed offer terms, a staff-confirmed eligible subtotal in integer cents, the arrival instant, and an optional locked Boost id. It calls the E01 calculator (`quoteOffer`, `selectQualifyingTier`, `selectBoost` in `src/lib/offers/calculator.ts`). Those two selectors are exported so the quote can name the tier and Boost `quoteOffer` already chose. There is no second window or tier implementation.

Rules the calculator already applies, and this service keeps:

- One tier: the highest inclusive threshold. Tiers are not summed.
- At most one Boost. With no lock, the highest bonus wins, then id order.
- The Boost is judged at `arrivalAt` in the offer timezone, not at bill confirmation. A locked Boost still applies when the bill is confirmed after its window.
- The total is capped at the eligible subtotal and is never negative. `base_discount_cents` and `boost_discount_cents` stay the calculator's pre-cap parts, so they can add up to more than `total_discount_cents` when the reason list includes `capped`.
- A subtotal below the lowest tier returns a quote with `total_discount_cents = 0` and `below_minimum = true`. That is not a refusal.

Sealed tiers have no id column. `offer_version_terms_ok` requires strictly increasing thresholds, so `tier_id` is `threshold:<cents>`.

A null offer version is an unbound challenge item. The quote refuses with `unbound`. It does not use a legacy flat offer. Other refusals: `withdrawn`, `outside_validity` (arrival before `valid_from` or at/after `valid_until`), `invalid_subtotal`, `invalid_arrival`, `invalid_terms`, `unknown_boost`, `boost_not_at_arrival`, `past_deadline` (confirmation at or after `challenge_items.redemption_deadline`).

`expires_at` is the earliest of offer `valid_until`, the visit deadline when one is passed, and an optional session instant. A later requested instant is clamped. It is not moved later.

`supersedeBoostQuote` is the bill correction. It returns the previous quote with `status = superseded` and a new active quote. The new quote copies `expires_at`, `arrival_at`, and `locked_boost_id`. `quote_version` increments. A later `valid_until` on the terms does not change `expires_at`. A correction at or after the visit deadline is `past_deadline` and does not mark the old quote superseded.

Arrival inside the published window is what qualifies the Boost. E01 bound mode still prices a base tier after `valid_until` until the redemption deadline, and withdraw only removes a version from selection. This quote refuses both. That difference is an open question below.

## E07-A2 arrival session (not built)

An arrival session locks one qualifying Boost. It is not redemption completion. `verify_redemption` and `verifyRedemptionTokenForPartner` stay as they are. The issued QR still expires after 15 minutes (`REDEMPTION_TTL_MINUTES` in `src/lib/redemption-expiry.ts`). That clock is not the session clock.

### Who can create one

Only a partner session from `requirePartnerSession()` (`src/lib/require-partner-session.ts`), the same gate `verifyRedemptionTokenForPartner` uses. The session's `restaurant_id` must equal `challenge_items.restaurant_id`. A partner for another restaurant cannot create or read the session. Members have no insert path. This PR adds no Server Action.

The item must be `assigned`, and `challenge_items.offer_version_id` must be non-null. A null version is `unbound` and creates nothing. The offer version row must match that id and the same `restaurant_id`. Arrival must fall inside `[valid_from, valid_until)` and before `redemption_deadline` when the deadline is set.

### Table shape

`boost_arrival_sessions` (proposed):

| Column | Notes |
| --- | --- |
| `id` | uuid primary key |
| `restaurant_id` | required, the partner's restaurant |
| `challenge_item_id` | required |
| `offer_version_id` | required, equal to the item's bound version |
| `redemption_id` | nullable. A link is not verification |
| `locked_boost_id` | text, nullable. The one Boost locked at arrival. Null when none qualified |
| `arrival_at` | timestamptz, set once |
| `expires_at` | timestamptz, set once |
| `idempotency_key` | text, required |
| `created_by_token_hash` | partner session hash, never the raw cookie |
| `status` | `open` or `closed` |

Proposed unique keys: `(restaurant_id, idempotency_key)`, and one `open` row per `challenge_item_id`.

`boost_quotes` (proposed), append-only:

| Column | Notes |
| --- | --- |
| `id` | uuid primary key |
| `session_id` | required |
| `quote_version` | integer, starts at 1 |
| `offer_version_id` | the bound version |
| `tier_id` | nullable text |
| `base_discount_cents` | integer |
| `boost_id` | nullable text |
| `boost_discount_cents` | integer |
| `total_discount_cents` | integer |
| `eligible_subtotal_cents` | integer |
| `below_minimum` | boolean |
| `reasons` | jsonb |
| `expires_at` | copied from the session |
| `superseded_at` | null on the active row |
| `created_at` | insert time |

Unique `(session_id, quote_version)`. The active quote is the row with `superseded_at` null. A bill correction runs `supersedeBoostQuote`, sets `superseded_at` on the old row, and inserts the next row. Both rows keep the session `expires_at`. The insert does not recompute expiry from "now".

### Lock, expiry, idempotency

On insert, call `quoteBoost` with the arrival instant and no locked id. Store the returned `boost_id` as `locked_boost_id`. Later quotes pass that id. A larger Boost that also covers the arrival cannot replace it.

`expires_at` is the earliest of offer `valid_until`, `challenge_items.redemption_deadline` when set, and `arrival_at + boost_session_minutes` when that column is not null. It is written once. A retry of the same idempotency key returns the existing session and quote and does not update `expires_at`. A lost response must not open a second session or push the end later.

### RLS and grants

Match `partner_sessions` and `offer_versions`: enable row level security, `revoke all` from `public`, `anon`, `authenticated`, and `service_role`, then grant only the verbs the service role needs. No policy for `authenticated`. Partner restaurant scope stays in the server action that already resolved the session. Do not trust a restaurant id from the browser. Quotes are not readable by the member client.

## How later slices plug in

E07-B (bill scan) may suggest a subtotal. Only the staff-confirmed integer cents is passed to `quoteBoost`. The scan does not choose a tier or a Boost.

E07-C (confirmation and atomic savings) consumes the active quote. Until that exists, verification is still `verify_redemption` / `verify_redemption_and_settle`. A quote is not a verified redemption and does not award a badge.

E07-D (disputes) reads the quote chain, including superseded rows. It does not mint a later `expires_at`.

No flag is set here. A later slice can add a server flag and leave it unset. Unset must mean no session table is queried from a page.

## Open questions for Noah

1. Should a visit that is already bound still quote after withdraw, or after `valid_until`, the way E01 bound mode still prices the base tier until `redemption_deadline`? This service refuses both.
2. `offer_versions.boost_session_minutes` is nullable. When it is null, is expiry only `valid_until` and the visit deadline, or is there a default duration?
3. When the total is capped, should the cap come out of the Boost first so the stored parts sum to `total_discount_cents`? Today the parts stay the calculator's pre-cap amounts.
4. E01 weekly windows use the local clock face. On a fall-back night both 1:30 occurrences match a 1:00–2:00 window. Is that the lock rule?
5. Is `threshold:<cents>` acceptable as `tier_id` until tiers grow a real id?
6. Must arrival require an issued, unexpired 15-minute redemption code, or only an assigned bound item inside its visit deadline?
7. Is the idempotency key scoped by restaurant and challenge item, and what is the retry body?
8. May an admin open a session, or only the partner for that restaurant?
9. One open session per challenge item, or one per redemption?
