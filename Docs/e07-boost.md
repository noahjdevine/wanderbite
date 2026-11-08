# E07 Boost quote and arrival sessions

E07-A1 is the pure quote in `src/lib/boost/quote.ts`. E07-A2 is partner-authenticated arrival sessions and append-only quotes. E07-B3 landed in #157 (merge `90e8339cab14d69244d8b5c1a01d8d5de09af5f1`) and adds the partner arrival screen. E07-A3 adds member "I'm here" on the existing Challenges ticket. Both stay off unless `E07_ARRIVAL_SESSIONS_ENABLED` is exactly `true`. Hosted arrival sessions are version `20261106034025`. Hosted bill receipts are version `20261107230502` (`supabase/migrations/20261107230502_e07_b2_bill_receipts.sql`, SQL unchanged). The A3 migration is not applied to hosted. `E07_BILL_SCAN_AZURE_ENABLED` stays unset. Pages do not query `boost_arrival_sessions` or `boost_quotes`.

## E07-A1 quote

`quoteBoost` takes sealed offer terms, a staff-confirmed eligible subtotal in integer cents, the arrival instant, and an optional locked Boost id. It calls the E01 calculator (`quoteOffer`, `selectQualifyingTier`, `selectBoost` in `src/lib/offers/calculator.ts`). There is no second window or tier implementation.

Rules the calculator already applies, and this service keeps:

- One tier: the highest inclusive threshold. Tiers are not summed.
- At most one Boost. With no lock, the highest bonus wins, then id order.
- The Boost is judged at `arrivalAt` in the offer timezone, not at bill confirmation. A locked Boost still applies when the bill is confirmed after its window.
- The total is capped at the eligible subtotal and is never negative.
- A subtotal below the lowest tier returns a quote with `total_discount_cents = 0` and `below_minimum = true`. That is not a refusal.

Noah 2026-11-05: when the total is capped, the cap comes out of the Boost first so `base_discount_cents + boost_discount_cents = total_discount_cents`. If the base alone still exceeds the total, the base is reduced only after the Boost is zero. That adjustment lives in `quoteBoost`, so a supersede copies the same parts. A qualifying Boost id is kept on the quote when the reduced bonus is still positive. When the cap removes the whole bonus, `boost_id` is null and the session layer still locks the Boost that qualified at arrival.

Sealed tiers have no id column. `tier_id` is `threshold:<cents>`.

A null offer version is an unbound challenge item. The quote refuses with `unbound`. It does not use a legacy flat offer. Other refusals: `withdrawn`, `outside_validity` (arrival before `valid_from` or at/after `valid_until`), `invalid_subtotal`, `invalid_arrival`, `invalid_terms`, `unknown_boost`, `boost_not_at_arrival`, `past_deadline` (confirmation at or after `challenge_items.redemption_deadline`).

`expires_at` on a pure quote is the earliest of offer `valid_until`, the visit deadline when one is passed, and an optional session instant. A later requested instant is clamped. It is not moved later.

`supersedeBoostQuote` is the bill correction. It returns the previous quote with `status = superseded` and a new active quote. The new quote copies `expires_at`, `arrival_at`, and `locked_boost_id`. `quote_version` increments. A later `valid_until` on the terms does not change `expires_at`. A correction at or after the visit deadline is `past_deadline` and does not mark the old quote superseded.

Arrival inside the published window is what qualifies the Boost. A new quote refuses a withdrawn version and an arrival outside `[valid_from, valid_until)`. It does not keep pricing the base tier until `redemption_deadline` the way E01 bound mode does.

## E07-A2 arrival session

An arrival session locks one qualifying Boost and stores the quote. It is not redemption completion. `verify_redemption` and `verifyRedemptionTokenForPartner` stay as they are. The issued QR still expires after 15 minutes (`REDEMPTION_TTL_MINUTES` in `src/lib/redemption-expiry.ts`). That clock, `challenge_items.redemption_deadline`, and `entitlement_credits.expires_at` stay separate.

`createBoostArrivalSession` and `supersedeBoostArrivalQuote` in `src/app/actions/partner-boost-arrival.ts` are the staff entry. Both return `disabled` before any read when `E07_ARRIVAL_SESSIONS_ENABLED` is not exactly `true`. The partner screen from #157 calls them only when that flag is exactly `true`.

### Who can create one

Only a partner session from `requirePartnerSession()`. The session's `restaurant_id` is that partner restaurant. A caller cannot pass a restaurant id. A partner for another restaurant, and anyone without a partner session (including an admin), gets a typed refusal and no row. Member geo check-in is E07-A3, not this action.

The item must be `assigned`, and `challenge_items.offer_version_id` must be non-null. A null version is `unbound` and creates nothing. The offer version row must match that id and the same `restaurant_id`. Arrival is the server clock at create. It must fall inside `[valid_from, valid_until)` and before `redemption_deadline` when the deadline is set. A live 15-minute redemption code is not required. `redemption_id` may be null. A non-null link must be a redemption for that same item and restaurant; the link is not verification. This partner action does not take a user id.

### Table shape

Migration `supabase/migrations/20261106034025_e07_a2_arrival_sessions.sql` (hosted version `20261106034025`; SQL body unchanged when the filename was aligned):

`boost_arrival_sessions`:

| Column | Notes |
| --- | --- |
| `id` | uuid primary key |
| `restaurant_id` | required, the partner's restaurant |
| `challenge_item_id` | required |
| `offer_version_id` | required, equal to the item's bound version |
| `redemption_id` | nullable. A link is not verification |
| `locked_boost_id` | text, nullable. The Boost locked at arrival. Null when none qualified |
| `arrival_at` | timestamptz, set once |
| `expires_at` | timestamptz, set once |
| `idempotency_key` | text, required |
| `created_by_token_hash` | partner session hash, never the raw cookie. E07-A3 makes this nullable; partner rows still set it |
| `status` | `open` or `closed` |
| `created_at` | insert time |

Unique `(restaurant_id, idempotency_key)`. One `open` row per `challenge_item_id`.

`boost_quotes`, append-only:

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

Unique `(session_id, quote_version)`. One row per session with `superseded_at` null. `base_discount_cents + boost_discount_cents = total_discount_cents`, and the total is at most the eligible subtotal. A bill correction runs `supersedeBoostQuote`, sets `superseded_at` on the old row, and inserts the next row. Both rows keep the session `expires_at`. The insert does not recompute expiry from "now".

Checked-in `src/types/database.types.ts` and `src/lib/schema-contract.ts` were hand-edited. `npm run types:db` was not run.

### Lock, expiry, idempotency

On insert, call `quoteBoost` with the arrival instant and no locked id. Store the qualifying Boost id as `locked_boost_id` (the quote's `boost_id`, or the Boost that qualified when the cap reduced its cents to zero). Later quotes pass that id. A larger Boost that also covers arrival cannot replace it.

`expires_at` is written once. When `offer_versions.boost_session_minutes` is null, the duration is 240 minutes. Otherwise it is that many minutes. The stored instant is the earliest of `arrival_at` plus that duration, offer `valid_until`, and `challenge_items.redemption_deadline` when the deadline is set. A retry of the same `(restaurant_id, idempotency_key)` returns the existing session and active quote and does not update `expires_at`. A lost response must not open a second session or push the end later.

### RLS and grants

Match `partner_sessions` and `offer_versions`: row level security is enabled, `revoke all` from `public`, `anon`, `authenticated`, and `service_role`, then grant only the verbs the service role needs. Sessions: `select`, `insert`. Quotes: `select`, `insert`, `update` (supersede sets `superseded_at` only; other columns are append-only). No policy for `authenticated`. Quotes are not readable by the member client. The server action still checks the partner restaurant. A trigger rejects a session whose restaurant or version does not match the challenge item.

`open_boost_arrival_session` and `supersede_boost_arrival_quote` are service-role functions. They do not replace `verify_redemption`. Partner authorization stays in the action.

## E07-A3 member check-in

Noah chose member "I'm here" plus a live location as the main Boost check-in. Staff `createBoostArrivalSession` stays the rare backup and is unchanged. The control sits on the assigned Challenges ticket, beside "I'm here — get my code". That redemption button is not the Boost check-in. The Boost label is "I'm here — lock Boost".

`checkInMemberBoost` in `src/app/actions/member-boost-arrival.ts` returns `disabled` before `requireUser()` and before any read when `E07_ARRIVAL_SESSIONS_ENABLED` is not exactly `true`. The Challenges page passes that boolean in. While it is false, the ticket does not render the control and does not call the browser location API.

When the flag is exactly `true`, a signed-in member with an assigned bound item and a restaurant pin can tap the control. The browser asks for a location only then (`maximumAge: 0`). The action loads the item, checks `challenge_cycles.user_id`, and reads `restaurants.lat` / `lon` for that item. A restaurant id from the browser is ignored. Another member's item is `forbidden` and writes nothing.

`assessMemberCheckIn` is pure. It uses `haversineMiles` times `1609.344` (the international mile that matches the radius in `haversineMiles`). It does not use the member's home `distance_band`. The radius is 100 meters. A reading older than 60 seconds, or more than 5 seconds ahead of the server, is `stale_location`. Accuracy is required and must be at most 100 meters, inclusive: exactly 100 meters is accepted, and a finite value above 100 meters is `poor_accuracy`. A missing value is `missing_accuracy`. The Challenges control forwards `coords.accuracy` unchanged. A missing restaurant pin is `restaurant_location_unavailable`. Failures are codes only. Exact coordinates are not returned or logged.

The bill is not invented. The open uses eligible subtotal `0`, the same placeholder the partner screen sends, so the stored quote is below minimum. The session is written only when `selectBoost` finds a Boost at the server arrival instant in the offer timezone. Otherwise the code is `boost_not_available` and no row is written. On that member path the session `locked_boost_id` is the qualifying Boost id, including when the placeholder quote is below minimum, so a later staff confirm keeps that Boost. Partner open still uses `qualifyingArrivalBoostId`, which stays null for a below-minimum quote. `expires_at` is written once. The same `(restaurant_id, idempotency_key)` for that same challenge item returns the existing session and does not move it. A key already stored for a different item is `invalid_idempotency_key` and that other session is not returned. The ticket key is `e07-member-geo:<challengeItemId>`, distinct from the partner key.

Migration `supabase/migrations/20261108001500_e07_a3_member_check_in.sql` adds nullable `created_by_user_id` (foreign key to `user_profiles`, on delete restrict) and `check_in_method` (`partner` or `member_geo`, default `partner`). `created_by_token_hash` is nullable. Exactly one of the token hash and the user id is set, and it has to match the method. `on delete restrict` is used because `boost_quotes` and `bill_scan_proposals` already restrict-delete the session, so cascade or set null cannot remove a member row. `open_boost_arrival_session` is not replaced. `open_member_boost_arrival_session` is service role only and checks that the user owns the item. Row level security and the grants on the tables are unchanged. Checked-in types were hand-edited. `npm run types:db` was not run. This migration is not applied to hosted.

Check-in does not verify a redemption and does not write savings, a badge, or XP. Location denied, stale, inaccurate, or outside the radius leaves the regular code path in place. Outside Boost hours, no Boost session is opened.

## How later slices plug in

E07-B1 (landed in #146) can suggest a subtotal. Only the staff-confirmed integer cents is passed to `quoteBoost`. The scan does not choose a tier or a Boost. This slice does not call `src/lib/boost/bill-proposal.ts`.

E07-C1 is pure confirmation planning in `src/lib/boost/confirm.ts` (`planBoostConfirmation`). `verify_redemption` and `verify_redemption_and_settle` do not call the planner. A quote is still not a verified redemption and does not award a badge.

E07-C2 persists that snapshot on `redemptions` through `src/lib/boost/settlement-store.ts` and `record_boost_settlement`. It landed in #160 (merge `1864e90a86348ba84843f2997815323759c63e97`). Migration `supabase/migrations/20261108010000_e07_c2_redemption_settlement.sql` is not applied to hosted. Verify RPCs are still unchanged.

E07-C3 calls that store after a successful partner verify and shows the `consume_quote` total beside the member QR and on partner redeem, only when `E07_ARRIVAL_SESSIONS_ENABLED` is exactly `true`. The flag stays unset. Verify SQL is still unchanged. It landed in #162 (merge `59caeedd51868b69e164f71946aebf9a699d6b53`).

The partner dashboard Arrival check-in control is a document link to `/partner/[slug]/arrival`. A client-side transition to that flag-gated route did not leave the dashboard; a full load of the same URL does. The control stays absent unless `E07_ARRIVAL_SESSIONS_ENABLED` is exactly `true`.

A verified Challenges ticket reads the same stored cents when that flag is exactly `true`. `loadStoredChallengeSavings` selects the settlement columns only then. A parsed `consume_quote` total, or a stored sealed amount, is shown as `Saved $X`, with the sealed offer on a separate `Offer` line. No snapshot, an unreadable snapshot, a sealed miss, a non-verified visit, or the flag off keeps today's offer line. The ticket does not recompute a quote and does not backfill older visits. A failed select does not fail the Challenges page.

E07-C4 reads those stored cents for Progress savings when the flag is exactly `true`. A `consume_quote` visit counts `total_discount_cents`. A `use_sealed_base` visit counts `sealed_discount_amount_cents` when that amount is stored. No snapshot, an unreadable snapshot, or a recorded sealed miss uses today's sealed lowest tier, then the 1000-cent fallback. `isEstimate` is false only when every counted verified visit has a stored amount. Any visit that used read-time sealed math or the 1000-cent fallback keeps the total estimated. Older visits are not backfilled. When the flag is not exactly `true`, `getMemberProgress` does not select the settlement columns. A failed settlement select falls back to today's total and does not fail Progress.

Noah confirmed on 2026-11-08: no arrival session stays on today's sealed lowest tier (`use_sealed_base`), including a null snapshot when that tier is missing. The 1000-cent display fallback stays in `getMemberProgress`. An open session whose active quote is the $0 placeholder (`eligible_subtotal_cents === 0`, or `below_minimum` with no positive staff subtotal) is `needs_subtotal` and does not fall back to the sealed base. A locked Boost still applies when confirmation is after session `expires_at` and before `redemption_deadline`. `expires_at` in the past is not by itself a refusal, and this helper does not move it. Instants are compared as absolute times. This slice does not apply the E01 fall-back clock face. A recorded snapshot replays as `already_settled` and is not discounted again.

E07-D (disputes) reads the quote chain, including superseded rows. It does not mint a later `expires_at`.

## Noah's decisions (2026-11-05)

These are decided. They are not open questions.

1. A bound visit after withdraw, or with arrival outside `[valid_from, valid_until)`, is refused. Do not price like E01 bound mode until `redemption_deadline`. Typed refusal, no row.
2. A null `boost_session_minutes` lasts 240 minutes. `expires_at` is the earliest of that duration, `valid_until`, and the visit deadline when set. A non-null duration uses that many minutes in the same earliest-of rule. Written once. Never moved later.
3. When the total is capped, reduce the Boost first so the stored parts sum to `total_discount_cents`. The total stays within the eligible subtotal and is never negative. Below minimum is total 0 with `below_minimum = true`, not a refusal.
4. Fall-back night: both 1:30 occurrences match a 1:00–2:00 window. That is the lock rule. It is the E01 local clock face.
5. `tier_id = threshold:<cents>` is acceptable until tiers get a real id.
6. Arrival does not require an issued, unexpired 15-minute redemption code. It requires an assigned bound challenge item inside its visit deadline. A live QR is a separate clock. `redemption_id` may stay null. A link is not verification.
7. Idempotency is unique `(restaurant_id, idempotency_key)`. A retry of the same key returns the existing session and quote and does not move `expires_at`. It does not open a second session or extend the timer.
8. Only the partner for that restaurant may open a session (`requirePartnerSession()`). Not an admin. Members have no insert path. Never trust a restaurant id from the browser. E07-A3 adds the member geo path above. This decision still bars an admin insert and still refuses a restaurant id from the browser. Staff check-in stays the backup.
9. One open session per `challenge_item_id`, not per redemption.
