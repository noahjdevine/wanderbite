# E06-A2 first-visit briefing

This slice shows a short sourced "First visit" block on a revealed restaurant challenge. It lists parking, arrival, what to expect, typical visit duration, and attire or accessibility only when a fact is stored. Every shown fact has an https source link and a "Checked" date in America/Chicago. A missing fact is omitted. If a restaurant has no active facts, the block is absent and the card matches the flag-off page.

`E06_BRIEFINGS_ENABLED` is server-only. Only the exact string `true` turns the block on. Unset, the challenges page does not query `restaurant_briefing_facts`. Unsetting the flag hides the block without a code change. This slice does not call a model from the page. It does not write credits, XP, verified visits, badges, bookings, or offers.

## What is stored

`restaurant_briefing_facts` has one row per restaurant and field. `body` is the fact text (1–400 characters). `source_url` is https only. `last_verified_at` is required. `status` is `active` or `paused`, and the default is `paused`. Client roles can select active rows and cannot insert, update, or delete. `service_role` writes. `is_sample` marks local fixtures. The UI shows "Sample" only when that column is true.

`content_sources` is unchanged by the briefing page. E06-B1 can register a `venue_page` separately. This slice does not write `restaurant_briefing_facts` from that refresh.

## Sample data

`scripts/fixtures/e06-sample-briefings.ts` and `scripts/seed.ts` insert local sample rows for Hutchins BBQ (`is_sample = true`) with `example.com` links and fictional wording. Parking, arrival, and duration are active. Accessibility is paused and must not render. The other seeded restaurants have no facts. The migration does not insert these rows.

## Research script

`npm run research:briefings` (`scripts/research-briefings.ts`) is an operator dry-run. It reads active restaurants. `restaurants.official_website` is the operator-accepted https site. When that column is set, the script fetches it first and treats it as the official host. Redirects from that URL may land on another domain. The final page is still official. Search hits that are not that stored URL still follow only same-site redirects. For each restaurant, the script also asks Claude Haiku `claude-haiku-4-5-20251001` to search with Anthropic's server-side web search tool on the Messages API (`type: web_search_20260318`, `name: web_search`). `max_uses` is 3. `user_location` is McKinney, Texas, US, `America/Chicago`. This Haiku snapshot calls the tool directly (`allowed_callers: ["direct"]`). The current tool version defaults to dynamic filtering, which this model does not support and which the API rejects with HTTP 400.

Candidate URLs come from `web_search_tool_result` pages and web-search citations. The script ranks an official-looking host first, then a reputable listing. It fetches robots.txt once per origin and skips a disallowed path without downloading that page. A disallowed listing does not consume one of the three page slots and does not start another web search. Allowed pages fill those three slots, preferring hosts robots.txt allows. From the first official page that returns text, the script also fetches up to four same-host links whose path or text matches menu, about, faq, visit, location, contact, hours, reservations, parking, or private-dining. `www` and the apex host count as the same site. Other subdomains and other hosts are not followed. Each page request sends browser-like `Accept` and `Accept-Language` headers and the user agent `WanderbiteBriefingResearchBot/1.0 (+https://wanderbite.com; first-visit research)`. HTTP 403 skips that URL only. The body is streamed and truncated to the first 1.5 MB of HTML instead of being dropped. Extracted text is capped at 8,000 characters. The report lists a reason for every restaurant.

It then asks Haiku, without the search tool, for facts the fetched page text supports. A fact is kept only when its `source_url` is https and was fetched in that run, and when one passage of that page contains a two-thirds share of the fact's distinctive words plus every number, time, price, and proper noun in the fact. Generic words such as "parking" and "street" do not carry a fact by themselves. The dry-run report prints that passage next to the fact. A URL the search mentioned but this run did not fetch cannot support a fact. Anything else is dropped. A result that is neither an official-looking host nor a reputable listing is not fetched.

If that search fails, the report records a reason for that restaurant: the HTTP status and Anthropic error text, a tool error such as `too_many_requests`, a paused search that returned no page, or no candidate URL. The script continues with the next restaurant until a cap stops it.

The script logs token usage and an estimated cost per restaurant. Token counts cover the search turn and the fact-extraction turn. The estimate adds the published Haiku token rates, Anthropic's web search price of $10 per 1,000 searches (`server_tool_use.web_search_requests`), and the Places list prices below. That total counts toward the cap of 25 restaurants and 2.00 USD (lower with `--limit` or `--cost-cap-cents`; the cost ceiling cannot exceed 5.00 USD). The free monthly Places cap is not subtracted, because it is shared by the whole billing account.

The report is JSON and markdown under `.briefings/` (gitignored). `--write` inserts `status = paused` and `is_sample = false`. It does not activate a row. An existing row for that restaurant and field is left alone. Hosted reads and writes are refused unless `WANDERBITE_BRIEFINGS_HOSTED_OK=1` for that run. [#131](https://github.com/noahjdevine/wanderbite/pull/131) did not run the script against hosted and did not set that variable. This search change was not run against hosted. The fetch change (official subpages, 1.5 MB truncation, robots skip) was not run against hosted. `E06_BRIEFINGS_ENABLED` stays unset. The script does not write the member AI ledger.

DuckDuckGo HTML is not used. A dry run of that path received an HTTP 202 bot challenge on every search and returned no pages.

## Official website

`restaurants.official_website` is nullable text. A check allows null or an https URL of 12 to 500 characters with no spaces. Client roles cannot select it. `service_role` can, because it already has table privileges. The public restaurants view does not include it.

`npm run research:official-websites` (`scripts/propose-official-websites.ts`) prints one proposal per active restaurant and does not write unless `--write` is set. Read the list, then re-run with `--write`. An existing `official_website` is left in place. `--write` does not insert briefing facts and does not activate a row.

When `GOOGLE_PLACES_API_KEY` is set, the proposal is Place Details `websiteUri` after Text Search Essentials (IDs Only) on the name and address. The details field mask is `id,displayName,formattedAddress,websiteUri`, which is Place Details Enterprise ($20 per 1,000 at the first paid tier). Atmosphere fields are not requested on this script. When the key is unset, the script uses the same Anthropic web search as briefing research. It proposes the first official host, or the first https host that is not a listing and not a blocked host. A city or location word in the restaurant name, including McKinney, does not count as that host. Yelp, OpenTable, visitmckinney.com, Toast (`toasttab.com`, including `order.toasttab.com`), Nextdoor, Roadtrippers (`roadtrippers.com`, including `maps.roadtrippers.com`), Mindtrip, and joe.coffee are not stored. If a turn returns only those hosts, the search continues for the restaurant's own domain instead of proposing the listing. A content path such as `/gallery` or `/visit` is stored as the site root. A chain location path such as `/locations/mckinney` is kept. A host that does not contain a name token is printed with `REVIEW`.

`--write` stores that https URL and, when `google_place_id` is null, the place id. Hosted reads and writes need `WANDERBITE_BRIEFINGS_HOSTED_OK=1` for that run. This script does not apply the migration.

Migration `20261105202512_e06_a2_restaurant_official_website.sql` is applied to hosted (2026-11-05). The filename matches the hosted `schema_migrations` version. Do not run `supabase db push` or `npm run types:db` for it. Checked-in `src/types/database.types.ts` and `src/lib/schema-contract.ts` were hand-edited. Apply it locally before either research script selects the column.

## Google Places

Places API (New) runs only when `GOOGLE_PLACES_API_KEY` is set and `WANDERBITE_GOOGLE_PLACES_OUTBOUND_DISABLED` is not the exact string `true`. The key is sent in the `X-Goog-Api-Key` header. It is not written into URLs, reports, or logs.

Checked 2026-11-05:

- [Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies) (page updated 2026-11-03). Place id is exempt from the caching restriction. Other Places content is not cached.
- [Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id). A place id may be stored and reused. Google recommends a free Place Details `id` refresh when an id is older than 12 months. This slice does not add that job. `restaurants.google_place_id` has no fetched-at column.
- [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) section 3 (Google ID caching) and section 14.3. Latitude and longitude from Places may be cached for 30 consecutive calendar days and then must be deleted. This slice does not request `location` and does not store Places coordinates. The location bias on Text Search uses the restaurant's own `lat` and `lon`.
- [Pricing list](https://developers.google.com/maps/billing-and-pricing/pricing). A call is billed at the highest SKU in the field mask. Text Search Essentials (IDs Only) is unlimited at a $0 list price. Place Details Enterprise is $20 per 1,000. Place Details Enterprise + Atmosphere is $25 per 1,000. Those are the first paid tier, after the free monthly cap and up to 100,000 requests. The estimate uses that tier and does not subtract the free cap.

What is stored, and for how long:

| Data | Where | How long |
| --- | --- | --- |
| Place id | `restaurants.google_place_id` | Indefinitely, which the Places policies allow. `--write` sets it only when the column is null. A stored id that does not match the name and address is not replaced. |
| Official website | `restaurants.official_website` | Until an operator changes it. This is the https URL a human accepted from the proposal list. The research script does not copy `websiteUri` into the column. It may fetch that URL for the current run when `official_website` is null, then discard it. |
| Fact sentence | `restaurant_briefing_facts.body` | Until an operator changes the row. `--write` inserts `status = paused` and `is_sample = false`. The sentence is a fixed template for a boolean. `editorialSummary` and `generativeSummary` are not requested and are ignored if a response contains them. |
| Source link | `restaurant_briefing_facts.source_url` | The https `googleMapsUri`, or `https://www.google.com/maps/search/?api=1&query_place_id=PLACE_ID` when that URI is missing. |
| Raw Places JSON, reviews, photos, ratings, phone, hours, and coordinates | Nowhere | Dropped when the process ends. Not written to `.briefings/`. |

A non-empty `attributions` array blocks every Places fact for that restaurant. This table has no column for a third-party provider credit, so those facts are not shown.

Parking, accessibility, reservations, groups, outdoor seating, dine-in, live music, dogs, and a restroom become one sentence per briefing field. Only `true` values are listed, except `reservable`, which is stated for both true and false. Missing fields are omitted. Duration and attire are not invented. A page fact for the same field is kept and the Places sentence is dropped. The support passage in the dry-run report is the field name and the boolean, so a reviewer can see the grounding. The model is not asked to rewrite it.

The member block shows the link text `Google Maps` (`translate="no"`, sans serif, 14px, weight 400, `#5E5E5E`, nowrap) when the source host is Google Maps. Other facts still say Source. The fact sits in the existing bordered card, which keeps the attribution in the same container as the sentence. Places content is not placed on a map.

Field masks, per restaurant, when the key is set:

- Research: Text Search `places.id` ($0), then Place Details `id,displayName,formattedAddress,googleMapsUri,attributions,websiteUri,accessibilityOptions,parkingOptions,reservable,goodForGroups,goodForChildren,outdoorSeating,dineIn,liveMusic,allowsDogs,restroom` ($0.025). A stored place id skips Text Search and calls Place Details once.
- Website proposals: the same Text Search, then Place Details `id,displayName,formattedAddress,websiteUri` ($0.020).

`displayName` and `formattedAddress` are used to accept or reject the place. They are not stored. A street number in the restaurant address must appear in the formatted address. The report prints the place id, the SKU, and the list-price estimate for that restaurant.

`E06_BRIEFINGS_ENABLED` stays unset. The challenge page does not call Places.

## Hosted

Migration `20261105181304_e06_a2_restaurant_briefings.sql` is applied to hosted (2026-11-05, empty table, Hosted DB Watcher PASS). `E06_BRIEFINGS_ENABLED` stays unset. Do not run `supabase db push` or `npm run types:db` for this slice. Checked-in `src/types/database.types.ts` and `src/lib/schema-contract.ts` were hand-edited for the new table. `npm run types:db` is a separate approved PR. The table is additive. Revert this PR to remove the code. The hosted table is empty. Once the code is reverted, the table is unused. No drop is required for that rollback.

## Local check

Apply the migration on a local database, then:

```bash
npm run seed
```

Set `E06_BRIEFINGS_ENABLED=true` in `.env.local` and open a challenge for Hutchins BBQ and one for a seeded restaurant with no facts. Hutchins shows First visit with parking, arrival, and duration, each with Source and Checked in America/Chicago, plus Sample. Attire and accessibility are absent. The other restaurant has no First visit block. Unset `E06_BRIEFINGS_ENABLED` and the block is gone, with no briefing query.

Do not point this seed or `npm run research:briefings` at hosted.
