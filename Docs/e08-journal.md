# E08 journal reflections

E08-A1 is pure server-side helpers in `src/lib/notes/reflection.ts` and this design. Members and partners see nothing new. No feature flag is introduced or turned on. There is no migration, no RPC, no UI, no AI call, and no Google API call. Nothing under `src/app` imports the module. `src/app/actions/bite-notes.ts` is unchanged. `NOTE_MAX` is read from `src/lib/notes/note-rules.ts` and is still 280.

Noah approved starting this slice on 2026-11-06. The field caps, the table name, and the open questions below are recommended defaults. They are not product decisions.

## What the helpers do

`validateReflectionFields` trims the five fields below and returns `{ ok: true, fields }`. It does not write a row. It does not invent a rating or a sentiment. A non-string is `invalid_text`. A control character (Unicode category Cc, including newline, tab, and NUL) is `invalid_text` and is not stripped. A trimmed value over that field's cap is `too_long` for that field. The helper does not truncate. Empty after trim is null. `return_interest` accepts only `yes`, `maybe`, or `no` after trim, or null. Any other value, including `Yes`, is `invalid_return_interest`. The first failure wins, in the order favorite bite, atmosphere, return interest, companion label, unpublished draft. A non-object input is `invalid_input`.

`buildGoogleReviewHandoff` returns `{ ok: true, url, source }` or `{ ok: false, code }`. A non-empty `googlePlaceId` wins. The URL is `https://search.google.com/local/writereview?placeid=<id>` and `source` is `place_id`. The place id must match `^[A-Za-z0-9_-]{10,256}$` after trim. Anything else is `invalid_place_id`, and the helper does not fall through to a Maps URL. A blank place id is ignored.

With no place id, the helper accepts one `mapsHttpsUrl`. `http:` is `insecure_url`. It is not rewritten to `https:`. Any other non-https scheme is `invalid_url`. A username, password, port, hash, backslash, or leftover space is `invalid_url`. The refusal does not echo the URL. Allowed hosts are `google.com`, `www.google.com` (path `/maps` or `/maps/...`), `maps.google.com`, `search.google.com` (path `/local/writereview` and a single valid `placeid` query), and `maps.app.goo.gl` (one path segment, no query). Any other host is `disallowed_host`, including `www.google.co.uk` and Yelp. Query names `review`, `reviewtext`, `review_text`, `review-text`, `comment`, `comments`, `draft`, `body`, `message`, `rating`, `stars`, `note`, and `text` are `invalid_url`. The helper does not add those keys, does not append a draft, and does not call Google.

`composePublicNotePublishPlan` describes the `bite_notes` write for an explicit publish: `{ note, rating, is_public: true }`. Rating must be an integer from 1 to 5 (`invalid_rating`). The public note is trimmed. Longer than `NOTE_MAX` is `too_long`. This slice refuses. It does not truncate. A control character in the public note is `invalid_text`. That is stricter than today's `saveBiteNote`, which only trims and checks length. This slice does not change that action. `fromReflection` is not copied onto the plan. `copiedFromReflection` is always false. An empty public note becomes `note: null`, which matches a rating-only `saveBiteNote`. No database write.

Length is JavaScript string length (UTF-16 code units), the same rule as `note.trim().length` in `saveBiteNote`.

## Recommended field caps

No other cap for these fields exists in the repo. These numbers are the helper's current limits and the suggested columns. They are not a prior decision.

| Field | Cap | Notes |
| --- | --- | --- |
| `favorite_bite` | 120 | Trimmed. Null when blank |
| `atmosphere` | 280 | Same count as `NOTE_MAX`, separate column |
| `return_interest` | `yes`, `maybe`, `no`, or null | Not a score |
| `companion_label` | 40 | A label the member typed. Not a user id |
| `unpublished_review_draft` | 1500 | Stays off `bite_notes` until an explicit publish copies only the chosen public note |

## Proposed table

Name: `journal_reflections`. The name is not used elsewhere in the repo. A later slice would add it. This PR does not.

| Column | Notes |
| --- | --- |
| `id` | uuid primary key |
| `user_id` | required. References `user_profiles(id)` on delete cascade |
| `redemption_id` | required. References `redemptions(id)` on delete cascade. Unique |
| `bite_note_id` | null until an explicit publish. References `bite_notes(id)` on delete set null |
| `favorite_bite` | text, null, length at most 120 |
| `atmosphere` | text, null, length at most 280 |
| `return_interest` | text, null, check `yes`, `maybe`, or `no` |
| `companion_label` | text, null, length at most 40 |
| `unpublished_review_draft` | text, null, length at most 1500 |
| `created_at`, `updated_at` | timestamptz |

A row may exist before any `bite_notes` row. The key is the owned redemption. `bite_note_id` stays null until publish. Do not store a second `restaurant_id` on this table. The handoff reads `restaurants.google_place_id` through the redemption so a later place-id edit is the one the URL uses.

Do not add a rating column here. The public rating is supplied at publish time and lives on `bite_notes`. Do not add a sentiment column. The helper never invents one.

A trigger, same posture as `bill_scan_proposals_scope`, rejects a row whose `user_id` is not `redemptions.user_id`. It checks ids only. It does not return reflection text. `search_path` is set. A later publish sets `bite_note_id` only when that note's `redemption_id` and `user_id` match this row.

Index `user_id` for the member's own list. `redemption_id` is unique.

## Why private columns stay off `bite_notes`

`bite_notes` (`007_bite_notes.sql`, `008_bite_notes_public.sql`) is `note`, `rating`, and `is_public`. There is no dish column. Public SELECT (`20261104070000_bite_notes_public_verified_rls.sql`) is `is_public = true` and `redemption_is_verified` (`status = 'verified'` and `verified_at` is not null). Owners use "Users manage own notes". No migration revokes column privileges on `bite_notes`. A private column on that table would be returned by `select *` on a public row. Reflections stay on `journal_reflections`. Publish copies only `note`, `rating`, and `is_public`.

## RLS and grants

Match `bill_scan_proposals` in `20261106150000_e07_b2_bill_receipts.sql`. Enable row level security. `revoke all` from `public`, `anon`, `authenticated`, and `service_role`. Grant `select`, `insert`, `update`, and `delete` to `service_role` only. No policy for `anon` or `authenticated`. No grant that lets the member client `select *`. The future server action uses `requireUser()` and still checks `user_id`. Do not trust a user id from the browser.

No view and no public join of this table to `bite_notes`. A view in `public` would bypass RLS unless it is `security_invoker`, and this design does not add one. Do not add a `security definer` function that returns reflection text. `redemption_is_verified` already returns a boolean and can stay the public-note gate.

`bill_scan_proposals` does not use `FORCE ROW LEVEL SECURITY`. This design does not add it. Service role bypasses RLS, which is why the trigger and the server action both check ownership.

## Explicit publish

1. A later action validates with `validateReflectionFields` and writes only `journal_reflections`.
2. The member chooses the public sentence and a rating. `composePublicNotePublishPlan` is the plan. Private fields are not arguments to the `bite_notes` write.
3. The write uses the same columns as `saveBiteNote`: `note`, `rating`, `is_public`. A public save still requires a verified redemption (`PUBLIC_REVIEW_REQUIRES_VERIFIED`). A private `bite_notes` save is a different action and is not this publish.
4. After that write, set `bite_note_id`. Do not copy `favorite_bite`, `atmosphere`, `return_interest`, `companion_label`, or the unpublished draft onto `bite_notes` unless the member passed that text as `publicNote` and it is at most `NOTE_MAX`.
5. Opening Google does not publish to WanderBite and does not set `is_public`.
6. No XP, no discount, and no drawing entry for posting. No Yelp mirror. The handoff is not a Google API publish and it does not prefill review text.

Today's editor at `/journal/notes/[redemptionId]` is unchanged.

## Google handoff

Verified in the repo: `restaurants.google_place_id` is `text`, added in `009_restaurants_google_places.sql`. The directory and the restaurant-image proxy use it. Prefer it. Build the writereview URL above. Do not call the Places API from this path.

`restaurants.google_photo_url` is a photo reference (`009_restaurants_google_places.sql`). It is not a review link. Do not use it. `restaurants.official_website` (`20261105202512_e06_a2_restaurant_official_website.sql`) is an https site for the restaurant. It is not a Maps URL. Do not use it as the handoff.

No `maps_url`, `google_maps_url`, or `place_url` column appears in `supabase/migrations` or on the `restaurants` Row in `src/types/database.types.ts`. This slice did not query hosted. A hosted-only column is UNKNOWN.

When `google_place_id` is missing, a later slice may pass an https Maps URL that an admin stored. This repo has nowhere to store that URL yet. UNKNOWN where it would live. Until it exists, `buildGoogleReviewHandoff` refuses `missing_destination`. It does not search Google and it does not put the restaurant name or the draft in a query.

Later UI, not this PR:

- Show the host and that the link opens Google's review or Maps page. Do not show the draft inside the URL.
- Copy writes only the URL. If the clipboard fails, leave the URL in a readonly field the member can select.
- Open is a normal link (`target="_blank"`, `rel="noopener noreferrer"`). If a popup is blocked, the same link remains. Do not open a second window.
- An analytics event may count that a handoff was used and whether `source` was `place_id` or `maps_url`. It must not include the URL, the place id, the draft, or the note. This slice emits no event.

## Later AI polish

Not this PR. A later adapter may rewrite only text the member selected. It reserves through the G13-A ledger (`ai_reserve` in `src/lib/ai-budget/index.ts`, `Docs/ai-budget.md`) before any provider call. Existing `feature_class` values are `protected_core`, `optional`, `maintenance`, and `guest`. Which class a member polish uses is UNKNOWN. It is not `maintenance` and it is not `guest`. The model must not invent a visit, a rating, a sentiment, a dish the member did not write, or a claim that Google published the text. The member accepts or discards the result. Accepting it edits the draft. It does not publish.

## Clocks

This slice does not read or write them.

- Issued QR TTL: 15 minutes.
- Visit window: `challenge_items.redemption_deadline` (840 hours).
- Credit expiry: `entitlement_credits.expires_at`.
- Receipt retention: `bill_scan_proposals.retain_until` from E07-B2. Untouched.

Checkout stays frozen. Criterion 11, a real profile on `credits`, still needs separate Noah authorization. Master E02, Master E04, and Master E05 stay open. This doc does not predict the D2=B measurement and does not claim acceptance. The Phase 1.5 production log read is done (#148).

## Blocked elsewhere

- E07-C confirmation, atomic savings, and QR UI. `Docs/e07-boost.md`. Not this PR.
- E07-D disputes. `Docs/e07-boost.md`. Not this PR.
- Member "I'm here" and geolocation. Product decided. UI not built. `Docs/e07-bill-scan.md`. Not this PR.
- Hosted apply of `20261106150000_e07_b2_bill_receipts.sql`. Not applied. Do not apply it here.
- Live Azure. `E07_BILL_SCAN_AZURE_ENABLED` stays unset. Do not put Azure credentials on Vercel.
- `E07_ARRIVAL_SESSIONS_ENABLED` stays unset.
- The A2 filename is already `20261106034025_e07_a2_arrival_sessions.sql` on main from #149. Do not rename it. Do not rename the B2 file in this PR.

## Open questions for Noah

1. Are the caps 120, 280, 40, and 1500 the ones to keep?
2. Should a reflection require an existing `bite_notes` row, or is an owned redemption enough until publish? This design uses the redemption, with `bite_note_id` optional.
3. Is place id, then an admin https Maps URL, then refuse, the right order? Country hosts such as `www.google.co.uk` are refused for now.
4. May `atmosphere` or the unpublished draft contain newlines? This helper refuses them as control characters.
5. Is the table name `journal_reflections` acceptable?
6. Which G13-A `feature_class` meters a later polish?
7. Should a private rating exist before publish? This design keeps rating on `bite_notes` only.
8. Where would an admin-verified Maps URL be stored? No column exists in the repo.

## Rollback

Revert the PR. Nothing calls the module. There is no migration.
