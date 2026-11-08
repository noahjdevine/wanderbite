# E07 bill scan

E07-B1 is the pure proposal helper. E07-B2 stores a private receipt and maps a Microsoft Azure Document Intelligence prebuilt-receipt result into that helper. E07-B3 is the partner check-in and receipt screen. Members see no new page. OCR may propose. It never finalizes a discount. Only a staff-confirmed integer is passed to `supersedeBoostArrivalQuote`, which calls `quoteBoost`. The scan action does not call `quoteBoost`. Verification is unchanged.

E07-A2 landed in #147 (merge `d0424a1914eca0799c05355a2d123e5478be5788`). Hosted `schema_migrations` version is `20261106034025` (name `e07_a2_arrival_sessions`). This PR renames the repo file to `supabase/migrations/20261106034025_e07_a2_arrival_sessions.sql`. The SQL body is unchanged. Noah's nine arrival answers live in `Docs/e07-boost.md`. They are not reopened here.

`E07_ARRIVAL_SESSIONS_ENABLED` stays unset in the repo, CI, and Vercel config. `E07_BILL_SCAN_AZURE_ENABLED` stays unset the same way. Both must be the exact string `true` or the new screen and the Azure read stay off. Hosted `schema_migrations` records the bill-receipts migration as version `20261107230502`. The repo file is `supabase/migrations/20261107230502_e07_b2_bill_receipts.sql` (renamed later so the stamp matches; the SQL body is unchanged). E07-B3 does not add a migration, does not run `supabase db push`, and does not run `npm run types:db`.

## Noah's decisions (2026-11-06)

1. The planned reader is Microsoft Azure Document Intelligence, model id `prebuilt-receipt` (API `2024-11-30`). Docs: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/receipt?view=doc-intel-4.0.0
2. Raw receipts are kept 7 days by default. `E07_RECEIPT_RETAIN_DAYS` overrides that with a positive integer up to 3660. Blank uses 7. The row stores `retain_until`.
3. Uploads go to the private bucket `bill-receipts`. JPEG, PNG, WebP, HEIC, and HEIF. Cap 10 MB (10,000,000 bytes). Longest side 8,000 pixels inclusive. Over that, the upload is refused. It is not downscaled.
4. A stored proposal requires an open `boost_arrival_sessions` row for the same restaurant and the member who owns the challenge item. `arrival_session_id` is required. There is no member "I'm here" UI in this PR.
5. Confidence below 0.8, null, or omitted on an OCR or Azure result is `low_confidence`. That cutoff is a product decision. A low score with a complete bill still returns the proposed cents plus the flag. Staff still confirm.

## E07-B1 proposal

`proposeBillEligibleSubtotal` in `src/lib/boost/bill-proposal.ts` takes `BillParts`-shaped cents (gross, tax, tip, category), an `ExclusionPolicy`, and optional scan meta. The eligible number is `applyExclusions` from `src/lib/offers/calculator.ts`. There is no second exclusion path.

Meta:

- `source`: `fixture`, `manual`, `ocr_stub`, or `azure_prebuilt_receipt`
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
- Document confidence below 0.8, null, or omitted on `ocr_stub` or `azure_prebuilt_receipt` is `low_confidence`. 0.8 is the product cutoff. An omitted per-line score is not a second document score. A per-line null or a per-line score below 0.8 is `low_confidence`. Fixture and manual scores may be omitted.
- Line items that are missing cents, that do not add up to the gross or to gross minus tax minus tip, or that disagree with a category total, set `ambiguous_line_items`. That check does not replace the proposed cents. Lines with no gross to compare against are ambiguous, and the subtotal stays null.
- A 13–19 digit run in a label or check identity is replaced with `[redacted]` and flagged `possible_card_data_stripped`. `cardDataStripped: true` sets the same flag when the caller already removed the digits.

`mergeStaffBillOverride` takes a successful proposal and a staff-confirmed integer. The confirmed cents win. The proposal remains on the returned object. A negative confirmation is `negative_parts`. A non-integer is `invalid_bill`. Nothing is written.

Synthetic inputs live in `src/lib/boost/fixtures/bill-scan.ts`. The $82 case is gross 10000, tax 800, tip 1000, tax and tip excluded, eligible 8200. That 8200 is the eligible subtotal in the E07-A1 quote example. The gross, tax, and tip are not from a receipt.

This module does not import `src/lib/boost/quote.ts` or `src/app`. E07-B3's partner action imports `proposeBillEligibleSubtotal` and `mergeStaffBillOverride`. It does not import `quote.ts`. The scan still does not choose a tier or a Boost.

## E07-B2 storage

Private bucket `bill-receipts` (`supabase/migrations/20261107230502_e07_b2_bill_receipts.sql`). `public` is false. MIME types are `image/jpeg`, `image/png`, `image/webp`, `image/heic`, and `image/heif`. File size limit is 10,000,000 bytes. There is no public read policy. Service role may insert, select, and delete objects in that bucket only. `restaurant-photos` is unchanged: public, jpeg/png/webp, 5 MiB.

Table `bill_scan_proposals`:

| Column | Notes |
| --- | --- |
| `id` | uuid primary key |
| `user_id` | required. The member who owns the receipt. Cascades when that profile is deleted |
| `restaurant_id` | required. Must match the arrival session |
| `arrival_session_id` | required. Foreign key to `boost_arrival_sessions` |
| `object_path` | `{user_id}/{id}` inside `bill-receipts`. Not a public URL |
| `content_type` | jpeg, png, webp, heic, or heif |
| `byte_size` | 1 through 10,000,000 |
| `width`, `height` | 1 through 8,000 |
| `source` | `fixture`, `manual`, `ocr_stub`, or `azure_prebuilt_receipt` |
| `proposal` | jsonb of the pure helper result, including uncertainty flags. No discount, tier, or Boost fields |
| `confirmed_eligible_subtotal_cents` | null until staff confirm. The only integer a later quote may use |
| `created_at` | insert time |
| `retain_until` | created_at plus the retention interval |
| `deleted_at` | set when the object is removed. The proposal jsonb stays |

No image bytes in the table. A trigger rejects a row whose session is missing, whose restaurant does not match, or whose `user_id` is not the challenge item's member. Insert also requires `status = open`. A later staff confirm or `deleted_at` does not require the session to still be open. The proposal jsonb and the object path do not change after insert.

RLS is on. Grants are revoked from `public`, `anon`, `authenticated`, and `service_role`, then `select`, `insert`, and `update` are granted to `service_role` only. There is no `authenticated` policy and no member `select` of the raw image. Partner restaurant scope stays in the server action that already resolved the session. Do not trust a restaurant id or an object path from the browser.

`storeBillScanProposal` in `src/lib/boost/receipt-store.ts` checks the open session before upload. JPEG, PNG, and WebP are re-encoded with the existing `sharp` package so EXIF and other metadata are dropped and orientation is applied. Dimensions are not reduced. HEIC and HEIF are not transcoded: dimensions come from the `ispe` box, and Exif item bytes are overwritten with zeros. If an `Exif\0\0` signature remains, the upload is refused and nothing is stored. This environment's `sharp` build does not decode phone HEIC (its HEIF reader lists AVIF). The HEIC path is the box parser, tested with a synthetic container, not a photograph.

Short-lived access is `mintReceiptSignedUrl`. TTL is 300 seconds. The member client does not receive the raw object. No page calls that function in this PR.

## Azure adapter

`readAzurePrebuiltReceipt` and `mapAzurePrebuiltReceipt` in `src/lib/boost/azure-receipt.ts` are propose-only. They accept a private object path and a content type, or fixture bytes in tests, and return the input shape of `proposeBillEligibleSubtotal` with `source: azure_prebuilt_receipt`. They do not call `quoteBoost`, pick a tier, or pick a Boost. They do not write `confirmed_eligible_subtotal_cents`.

Field mapping, from the v4.0 `prebuilt-receipt` schema:

- `Total` is gross cents. `Subtotal` is not copied and is not added to tax or tip.
- Tax is `TotalTax`, else legacy `Tax`, else the sum of `TaxDetails` amounts when every amount is an exact cent value. `TotalTax` wins when both are present.
- `Tip` is tip cents. A figure that is not an exact cent value stays null. Cents are not invented.
- `Items` become line items. The line amount is `TotalPrice`, not quantity times unit price. `Description` is the label. `Category` is copied only when that optional field is present. Azure's receipt schema has no item category.
- `MerchantName`, `MerchantAddress`, `TransactionDate`, and `TransactionTime` are joined into `checkIdentity` when present. The phone number and `Payments` are not copied.
- Document confidence is the document score. A money field score below 0.8 or null lowers that score. An omitted document score stays omitted so the helper flags `low_confidence`. An omitted per-field score does not, by itself, replace a present document score.
- 13–19 digit runs are replaced with `[redacted]` before the helper sees them. The raw PAN is not returned.

Live HTTP is `POST {endpoint}/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=2024-11-30` with header `Ocp-Apim-Subscription-Key`, then a same-origin poll of `operation-location`. The body is the object bytes. Azure is not given a long-lived URL.

The call runs only when `E07_BILL_SCAN_AZURE_ENABLED` is exactly `true` and both `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` (https resource root, no path) and `AZURE_DOCUMENT_INTELLIGENCE_KEY` are set. Otherwise the result is `disabled` or `missing_config`. It does not throw. The flag is unset in this PR. Tests use synthetic JSON in `src/lib/boost/fixtures/azure-receipt.ts`. They do not call Azure. No receipt image is committed. Secret values are not printed.

## How a proposal reaches `quoteBoost`

1. The partner checks in an in-progress challenge item. `createBoostArrivalSession` locks the visit with `eligibleSubtotalCents: 0`, so the first quote is below the offer minimum and the discount is $0.
2. On that open session, validate one image, strip metadata, and store the object plus one proposal row. The row is written once. When `E07_BILL_SCAN_AZURE_ENABLED` is exactly `true`, the action reads Azure before that insert so the stored proposal is the read. When the flag is not exactly `true`, Azure is not called and the stored proposal is `manual`.
3. The screen shows the parsed receipt total, the proposed eligible subtotal, and the confidence. A score under 0.8, a `low_confidence` flag, a null subtotal, or a manual proposal requires the partner to type the amount. The upload does not call `quoteBoost` or `supersedeBoostArrivalQuote`.
4. The partner presses Confirm. `mergeStaffBillOverride` keeps the proposal. The action writes `confirmed_eligible_subtotal_cents` and then calls `supersedeBoostArrivalQuote` with that integer. The proposal jsonb and the object path do not change.
5. Only that integer is `eligibleSubtotalCents` on the superseded quote, along with the session's arrival instant and locked Boost. The scan does not choose either. Each Challenge Credit's 1000-cent minimum discount rule is unchanged: `quoteBoost` still uses the offer's own tiers, and a subtotal under the lowest tier stays `below_minimum` with a $0 discount.

Uncertainty flags do not by themselves become a discount. A null proposal subtotal can still be confirmed by the partner. The confirmation is the only figure the quote sees.

## Retention, cleanup, account deletion

`retain_until` is `created_at` plus N elapsed 24-hour days (`receiptRetainUntil`). The default N is 7. `E07_RECEIPT_RETAIN_DAYS` overrides it. This is not the 15-minute QR TTL, the 840-hour visit deadline, or credit expiry.

`cleanupExpiredReceipts` in `src/lib/boost/receipt-retention.ts` deletes objects whose `retain_until` has passed and sets `deleted_at`. Nothing schedules it. No cron route imports it. Do not add a hosted cron in this slice.

`deleteAccount` calls `cleanupMemberReceiptObjects` before `auth.admin.deleteUser`. That deletes this member's objects in `bill-receipts`. The rows then drop with `user_profiles` (`on delete cascade`). If `bill_scan_proposals` is missing (this migration is not on hosted yet), cleanup is skipped and account deletion continues. Any other cleanup failure stops the account deletion and leaves the user in place. The client error does not include object paths or storage errors.

## Clocks

Four clocks stay separate. This slice does not read or write the first three.

- Issued QR TTL: `REDEMPTION_TTL_MINUTES` (15) in `src/lib/redemption-expiry.ts`.
- Visit window: `challenge_items.redemption_deadline` (840 hours from assignment).
- Credit expiry: `entitlement_credits.expires_at`.
- Receipt retention: `retain_until`, default 7 elapsed days, `E07_RECEIPT_RETAIN_DAYS`.

Do not change `verify_redemption` or `verifyRedemptionTokenForPartner`.

## E07-B3 partner flow

Signed-in partner of that restaurant only. No member page.

`/partner/[slug]/arrival` calls `notFound()` unless `E07_ARRIVAL_SESSIONS_ENABLED` is exactly `true`. The partner dashboard link is absent in that same case. The page does not query `boost_arrival_sessions` while the flag is off.

The screen asks for the guest email and lists that member's assigned, bound challenge item at this restaurant while the visit window is open. Check in calls `createBoostArrivalSession` with idempotency key `e07-arrival:{challengeItemId}` and `eligibleSubtotalCents: 0`. The restaurant id comes from the partner session.

On the open session the partner uploads one image: jpeg, png, webp, heic, or heif, at most 10,000,000 bytes. `uploadPartnerBillReceipt` stores it with `storeBillScanProposal`. It calls `readAzurePrebuiltReceipt` only when `E07_BILL_SCAN_AZURE_ENABLED` is exactly `true`. Otherwise it stores a manual proposal and the screen asks for the eligible subtotal. A parsed score under 0.8, or a `low_confidence` flag, shows the parsed total and confidence and still requires the typed amount. Confirm is a separate action. It does not run from the upload.

Server action body size is 12,000,000 bytes so the multipart wrapper can carry a 10,000,000-byte file. The action still refuses a larger file.

## Preview test checklist

This pull request does not set either flag. A preview test turns them on only in that preview environment.

- `E07_ARRIVAL_SESSIONS_ENABLED=true` shows Arrival check-in for a signed-in partner of the restaurant. Any other value, including unset, shows no link and `/partner/[slug]/arrival` is a 404. A member account is not a partner session.
- `E07_BILL_SCAN_AZURE_ENABLED=true` plus the preview's existing `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` and `AZURE_DOCUMENT_INTELLIGENCE_KEY` parses a receipt. With the Azure flag unset, the upload still stores and asks for the amount. No Azure call in that case.
- Test data: one member email, one `challenge_items` row at that restaurant with `status = assigned`, a non-null `offer_version_id`, and a visit deadline still in the future. The offer version `exclusions` object has `exclude_tax`, `exclude_tip`, and `categories`. Hosted already has bill receipts as `schema_migrations` version `20261107230502`. Do not run `supabase db push`.
- One receipt image, jpeg, png, webp, heic, or heif, at or under 10,000,000 bytes. None is committed in this repo.
- Check-in shows no discount. The scan shows parsed total and confidence. Under 0.8 there is no confirm-from-scan button. The quote changes only after Confirm. A subtotal under the offer's own tier stays a $0 discount. The 1000-cent credit floor is not edited.

## Blocked elsewhere

- Member "I'm here" is E07-A3, landed in #158 (merge `4130bfbf3fa7af03a72af6057fc7eccce4d90fa8`), on the Challenges ticket. This bill-scan screen does not add it.
- E07-C1 landed in #159 (merge `79b17e5f64cbe552960d11c9f19d82f1850274d8`): helpers in `src/lib/boost/confirm.ts`, not the QR UI. Confirming a subtotal supersedes the quote. It does not verify a redemption or write a badge. E07-C2 persists the snapshot on `redemptions` through an unused store. That is not the QR UI. C3 will show the amount beside the QR.
- E07-D disputes. Not in this slice.
- Do not set `E07_BILL_SCAN_AZURE_ENABLED` or `E07_ARRIVAL_SESSIONS_ENABLED` in repo config, CI, or production. A preview test may set them on that preview only.
- Hosted bill receipts are already version `20261107230502`. The repo filename now matches. Do not apply it again. Do not apply the A3 member migration from this note. Do not put new Azure credentials on Vercel. The preview already has the endpoint and key.

## Rollback

Revert the PR. Hosted is unchanged. The A2 rename is filename-only. Hosted already has version `20261106034025`. If a revert restores the old filename, fold that rename into the next real PR. Do not open a rename-only follow-up.
