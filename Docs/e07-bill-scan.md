# E07 bill scan

E07-B1 is a pure proposal helper. Members and partners see nothing new. This PR does not add a table, bucket, RPC, page, flag, migration, or hosted write. It does not call an OCR provider and it does not ship a receipt image. OCR may propose. It never finalizes a discount.

E07-A2 (arrival sessions) is not built here. Its nine open questions stay unanswered. See [Blocked elsewhere](#blocked-elsewhere-e07-a2).

## E07-B1 proposal

`proposeBillEligibleSubtotal` in `src/lib/boost/bill-proposal.ts` takes `BillParts`-shaped cents (gross, tax, tip, category), an `ExclusionPolicy`, and optional scan meta. The eligible number is `applyExclusions` from `src/lib/offers/calculator.ts`. There is no second exclusion path.

Meta:

- `source`: `fixture`, `manual`, or `ocr_stub`
- check identity string
- line items with an optional category and a confidence of 0–1, null when unknown, or omitted
- document confidence, same three shapes

Success:

`{ ok: true, proposed_eligible_subtotal_cents, applied_exclusions, uncertainty_flags, source, line_items?, check_identity? }`

`proposed_eligible_subtotal_cents` is an integer or null. The object has no tier, Boost, or discount field.

Refusals: `invalid_bill`, `negative_parts`, `exclusion_overflow`.

Rules:

- A negative gross, tax, tip, category, or line amount is `negative_parts`. A non-integer amount is `invalid_bill`.
- When the policy excludes tax, tip, or a named category and that figure is null, the subtotal is missing. The helper does not treat the null as zero and does not sum line items into a subtotal.
- Tax or tip that the policy does not exclude may be null. Those figures are not part of the eligible cents.
- `applyExclusions` clamps at zero. If a one-cent-higher gross still clamps, the excluded amount exceeded gross. That case is `exclusion_overflow`, not a proposal of 0. Exclusions that land on zero exactly return 0.
- Uncertainty flags, in this order: `low_confidence`, `missing_subtotal`, `ambiguous_line_items`, `possible_card_data_stripped`. A flag does not invent cents. A low score with a complete bill still returns the calculator's cents, plus `low_confidence`.
- Document confidence below 0.8, null, or omitted on `ocr_stub` is `low_confidence`. 0.8 is a helper default, not a product decision. An omitted per-line score is not a second document score. A per-line null or a per-line score below 0.8 is `low_confidence`.
- Line items that are missing cents, that do not add up to the gross or to gross minus tax minus tip, or that disagree with a category total, set `ambiguous_line_items`. That check does not replace the proposed cents. Lines with no gross to compare against are ambiguous, and the subtotal stays null.
- A 13–19 digit run in a label or check identity is replaced with `[redacted]` and flagged `possible_card_data_stripped`. `cardDataStripped: true` sets the same flag when the caller already removed the digits.

`mergeStaffBillOverride` takes a successful proposal and a staff-confirmed integer. The confirmed cents win. The proposal remains on the returned object. A negative confirmation is `negative_parts`. A non-integer is `invalid_bill`. Nothing is written.

Synthetic inputs live in `src/lib/boost/fixtures/bill-scan.ts`. The $82 case is gross 10000, tax 800, tip 1000, tax and tip excluded, eligible 8200. That 8200 is the eligible subtotal in the E07-A1 quote example. The gross, tax, and tip are not from a receipt.

This module does not import `src/lib/boost/quote.ts` or `src/app`. Nothing under `src/app` imports it. A later slice passes only `confirmed_eligible_subtotal_cents` into `quoteBoost`.

## E07-B2 storage (not built)

No receipt bucket exists. The only storage bucket in the repo is `restaurant-photos` (`supabase/migrations/025_restaurant_photos_bucket.sql`). It is public, allows `image/jpeg`, `image/png`, and `image/webp`, and caps files at 5 MiB. Do not put receipts there. The private receipt bucket name is **UNKNOWN**. Do not invent one.

Proposed table `bill_scan_proposals` (not migrated):

| Column | Notes |
| --- | --- |
| `id` | uuid primary key |
| `user_id` | member who owns the receipt. Whether a row can exist without a member is **UNKNOWN** |
| `restaurant_id` | partner restaurant. Required once a partner confirms |
| `arrival_session_id` | nullable until E07-A2 exists. Whether an upload requires an open session is an open question |
| `object_path` | key inside the private bucket. Not a public URL |
| `content_type` | allowlist **UNKNOWN** |
| `byte_size` | cap **UNKNOWN** |
| `width` | cap **UNKNOWN** |
| `height` | cap **UNKNOWN** |
| `source` | `fixture`, `manual`, `ocr_stub`, or a later provider id |
| `proposal` | jsonb of the pure helper result, including uncertainty flags |
| `confirmed_eligible_subtotal_cents` | null until staff confirm. The only integer a later quote may use |
| `created_at` | insert time |
| `retain_until` | created_at plus the retention interval. The interval is an open question |
| `deleted_at` | set when the object and row are removed |

Proposed object path: `{user_id}/{id}`. No image bytes in the table. Strip EXIF and other metadata before the object is stored. That strip is not implemented here.

Short-lived access is a server-minted signed URL. The TTL is **UNKNOWN**. The member client does not receive the raw object.

## OCR adapter (not built)

A later adapter is propose-only. It accepts a private object path and a content type and returns the input shape of `proposeBillEligibleSubtotal` with `source` set to that provider. It does not call `quoteBoost`, pick a tier, or pick a Boost. It does not write the confirmed cents.

This slice's only reader is the in-process helper. `ocr_stub` is a label on synthetic fixtures. There is no network client and no provider SDK.

Real receipt images do not go to a provider without a consent decision that is not made here.

## Retention, cleanup, account deletion

The master plan proposes deleting raw receipts on a short retention, with 7 days as the proposed default, configurable. That number is not decided. No cron is added here.

`deleteAccount` in `src/app/actions/auth.ts` calls `auth.admin.deleteUser`. It does not delete storage objects. A foreign key from `user_id` to `user_profiles` would drop rows only. E07-B2 has to delete this member's receipt objects on that path, and a retention job has to delete objects whose `retain_until` has passed. Neither hook is implemented.

## How a proposal reaches `quoteBoost`

E07-A2 is still design-only (`Docs/e07-boost.md`). After a session exists, the sequence is:

1. Store the upload and run the adapter, or accept staff-entered parts.
2. `proposeBillEligibleSubtotal` records the proposal and the flags.
3. Staff confirm an integer. `mergeStaffBillOverride` keeps the proposal for audit and returns `confirmed_eligible_subtotal_cents`.
4. That integer is `eligibleSubtotalCents` on `quoteBoost`, along with the session's arrival instant and locked Boost. The scan does not choose either.

Uncertainty flags do not by themselves become a discount. A null proposal subtotal can still be confirmed by staff. The confirmation is the only figure the quote sees.

E07-C and E07-D stay out of scope. A quote is still not a verified redemption.

## RLS and grants

Match `partner_sessions` (`supabase/migrations/20260906195909_partner_sessions.sql`): enable row level security, `revoke all` from `public`, `anon`, `authenticated`, and `service_role`, then grant only the verbs the service role needs. No policy for `authenticated`. No member `select` on the raw image. Partner restaurant scope stays in the server action that already resolved the session. Do not trust a restaurant id or an object path from the browser.

The storage object policies for the private bucket, when one exists, must not copy the public read policy on `restaurant-photos`.

## Clocks

Three clocks stay separate. This slice does not read or write them.

- Issued QR TTL: `REDEMPTION_TTL_MINUTES` (15) in `src/lib/redemption-expiry.ts`.
- Visit window: `challenge_items.redemption_deadline` (840 hours from assignment).
- Credit expiry: `entitlement_credits.expires_at`.

Receipt retention is a fourth clock. Do not reuse any of the three. Do not change `verify_redemption` or `verifyRedemptionTokenForPartner`.

## Blocked elsewhere (E07-A2)

These nine questions are Noah's. They are copied here so this slice does not look like it settled them. **No answer is given.** The text of record is the "Open questions for Noah" section of `Docs/e07-boost.md`.

1. Should a visit that is already bound still quote after withdraw, or after `valid_until`, the way E01 bound mode still prices the base tier until `redemption_deadline`? The quote service refuses both.
2. `offer_versions.boost_session_minutes` is nullable. When it is null, is expiry only `valid_until` and the visit deadline, or is there a default duration?
3. When the total is capped, should the cap come out of the Boost first so the stored parts sum to `total_discount_cents`? Today the parts stay the calculator's pre-cap amounts.
4. E01 weekly windows use the local clock face. On a fall-back night both 1:30 occurrences match a 1:00–2:00 window. Is that the lock rule?
5. Is `threshold:<cents>` acceptable as `tier_id` until tiers grow a real id?
6. Must arrival require an issued, unexpired 15-minute redemption code, or only an assigned bound item inside its visit deadline?
7. Is the idempotency key scoped by restaurant and challenge item, and what is the retry body?
8. May an admin open a session, or only the partner for that restaurant?
9. One open session per challenge item, or one per redemption?

## Open questions for Noah (bill scan)

1. Which OCR provider, if any? **UNKNOWN.** This slice does not call one.
2. Is raw-receipt retention 7 days by default, and is that interval configurable?
3. What are the max upload size, pixel dimensions, and content types? **UNKNOWN.** The `restaurant-photos` limits are not a receipt decision.
4. Does a member upload require an open arrival session?
5. Is 0.8 the low-confidence cutoff, or only this helper's default?
