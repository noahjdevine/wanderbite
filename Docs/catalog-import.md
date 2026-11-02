# Catalog import

Bulk-import restaurants for any market from one CSV or JSON file, then optionally publish clearly marked TEST offer versions. The tool plans against the database, writes a review file under `.supply-gate/`, and applies that file only when you opt in. It does not delete rows and it does not repoint `challenge_items`.

There is no ZIP column. `zip` stays in the import file. The street address is what gets stored on `restaurants.address`.

Sample files (fake data only): `scripts/fixtures/catalog-import-sample.json` and `scripts/fixtures/catalog-import-sample.csv`.

## File format

CSV header or a JSON array of objects. Unknown columns are rejected.

| Column | Required | Notes |
| --- | --- | --- |
| `market_slug` | yes | Existing or new market, e.g. `mckinney-tx`. |
| `market_name`, `market_state`, `market_timezone` | when the market is new | IANA time zone, e.g. `America/Chicago`. A new market is created `active`, country `US`, currency `USD`. |
| `name` | yes | |
| `slug` | no | Omitted slugs use `slugify` from `src/lib/slugify.ts`, then `-2`, `-3`, … A rerun reuses the slug of the row with the same place id or the same normalized name and address. |
| `address` | yes | Stored as given. |
| `city` | yes | Used for geocoding and for the outside-market warning. Not a database column. |
| `zip` | yes | 5-digit US ZIP. Not a database column. |
| `lat`, `lon` | both or neither | `lat` in [-90, 90], `lon` in [-180, 180]. |
| `google_place_id` | no | |
| `cuisine_tags` | no | Pipe-separated. Each tag must be a cuisine id or keyword from `src/lib/cuisines.ts`. |
| `is_vegan`, `is_dairy_free`, `is_halal` | no | `true`/`false`/`yes`/`no`/`1`/`0`. Default false. |
| `price_range`, `neighborhood` | no | |
| `status` | no | `active` or `paused`. Default `active`. |
| `base_discount_cents` | when publishing an offer from the row | Lowest tier. Must be at least 1000. Threshold cents is `max(base, 4000)`. |
| `capacity_max_redemptions` | no | Default 50. |
| `valid_from`, `valid_until` | no | ISO timestamps. Default now, and now plus 12 UTC calendar months. The window must still be selectable (`valid_until` more than 840 hours ahead). |
| `is_test_offer` | no | `true` marks the publish audit row as a test offer. |

JSON `cuisine_tags` may be a string array instead of a pipe-separated string.

## Match, dedupe, coordinates

Within one file, two rows with the same `google_place_id`, the same slug in a market, or the same normalized name + address + ZIP are an error. The message names every line. The whole file is rejected unless `--skip-invalid`.

Against the database, in order: `google_place_id`, then `(market, slug)`, then normalized name + address + ZIP (the ZIP is the last 5-digit group in the stored address). A match updates only changed fields. Re-running the same file is unchanged.

Rows that share a `google_place_id` or a normalized name + address in one market are possible duplicates, as are `slug` and `slug-2`. The plan lists them. `--resolve-duplicate keep=<slug> drop=<slug>` pauses the dropped row only when the plan reported that pair.

`retire_restaurant` pauses a row that already has challenge items or offer versions, and deletes a row that has neither. This tool never deletes. It calls `retire_restaurant` only when that call will pause. A duplicate with zero challenge items and zero offer versions is set to `paused` directly and audited as `restaurant.deactivate`.

Missing coordinates are filled from Google Places: place details when `google_place_id` is set, otherwise Find Place from `address, city, zip`. Provenance on the plan is `provided`, `places:place_id`, `places:address`, or `preserved`. A geocoded point does not replace a non-null database coordinate unless `--refresh-coordinates`. Results are cached in `.supply-gate/geocode-cache.json`. `WANDERBITE_GOOGLE_PLACES_OUTBOUND_DISABLED=true` turns missing coordinates into errors and does not call Google. A row more than 50 km from the centroid of the market's other points is a warning, not an error.

## Plan and apply

Plan is the default. It is read-only aside from the plan file and the geocode cache.

```bash
npm run catalog:import -- --plan --file .supply-gate/restaurants.json
```

`--plan-output` defaults to `.supply-gate/catalog-import-plan.json`. Written paths must stay inside `.supply-gate/`. The summary prints create / update / unchanged / skipped / errors per market, plus pause, publish, and withdraw counts.

Apply refuses unless all of these are true:

- `WANDERBITE_CATALOG_APPLY=1`
- `--confirm` lists exactly the plan's markets
- `--actor` is an admin `user_profiles.id`
- the hash of the markets' rows still matches the plan (a change since planning refuses the apply)

```bash
WANDERBITE_CATALOG_APPLY=1 npm run catalog:import -- \
  --apply --plan-file .supply-gate/catalog-import-plan.json \
  --actor <admin-uuid> --confirm mckinney-tx
```

Flags such as `--test-offers` and `--resolve-duplicate` belong on the plan command. Apply executes the plan file.

`--from-db <market-slug>` writes `.supply-gate/catalog-import-from-<slug>.json` from current rows and does not change the database. ZIP and city are parsed from the stored address when it looks like `, City, ST 75069`.

## Test offer versions

`--test-offers` adds a publish action for every active restaurant in the plan's markets that does not already have `current_offer_version_id` and is not the dropped side of `--resolve-duplicate`.

Default terms, checked with `offerVersionTermsProblem` and the 1000-cent floor:

- one tier, `discount_cents` 1000, `threshold_cents` 4000
- `capacity_max_redemptions` 50 (`--test-offer-capacity` overrides this)
- `timezone` and `capacity_timezone` are the market time zone
- `capacity_window_kind` `calendar_month`
- `valid_from` now, `valid_until` now plus 12 calendar months
- exclusions `{ exclude_tax: true, exclude_tip: true, categories: [] }`

`publish_offer_version(draft_id, actor)` writes the version and sets `current_offer_version_id`. There is no `is_test` column. After publish, the tool merges `is_test: true` and `source: "catalog-import --test-offers"` into that `offer.publish` audit row. A row with `is_test_offer: false` and offer columns is published the same way without `is_test`.

```bash
npm run catalog:import -- --plan --file .supply-gate/restaurants.json \
  --resolve-duplicate keep=hutchins-bbq drop=hutchins-bbq-2 \
  --test-offers

WANDERBITE_CATALOG_APPLY=1 npm run catalog:import -- \
  --apply --plan-file .supply-gate/catalog-import-plan.json \
  --actor <admin-uuid> --confirm mckinney-tx
```

Withdraw every version in the confirmed markets whose publish audit row has `is_test` true:

```bash
npm run catalog:import -- --plan --withdraw-test-offers --market mckinney-tx

WANDERBITE_CATALOG_APPLY=1 npm run catalog:import -- \
  --apply --plan-file .supply-gate/catalog-import-plan.json \
  --actor <admin-uuid> --confirm mckinney-tx
```

That calls `withdraw_offer_version`. It does not withdraw a publish that was not marked `is_test`.

## Commands for the current McKinney test catalog

Copy an import file into `.supply-gate/` (or build one with `--from-db mckinney-tx` and fill any ZIP the address parser misses). Then:

```bash
npm run catalog:import -- --plan --file .supply-gate/mckinney.json

WANDERBITE_CATALOG_APPLY=1 npm run catalog:import -- \
  --apply --plan-file .supply-gate/catalog-import-plan.json \
  --actor <admin-uuid> --confirm mckinney-tx

npm run catalog:import -- --plan --file .supply-gate/mckinney.json \
  --resolve-duplicate keep=hutchins-bbq drop=hutchins-bbq-2 \
  --test-offers

WANDERBITE_CATALOG_APPLY=1 npm run catalog:import -- \
  --apply --plan-file .supply-gate/catalog-import-plan.json \
  --actor <admin-uuid> --confirm mckinney-tx
```

Then rerun `scripts/sql/e02-supply-snapshot.sql` in a read-only session, save the JSON cell to `.supply-gate/hosted-catalog.json`, and run `npm run supply:gate`. Do not treat a disposable-database gate print as a hosted result. E02 and E04 stay open.

## Rollback

Revert the pull request. There is no schema change. Data: `--withdraw-test-offers --confirm mckinney-tx` removes test supply. Coordinate updates and paused rows are in the plan file; re-apply a plan built from the previous values to put them back.

## What this does not do

No migration, no `supabase db push`, no `npm run types:db`, no change to catalog-conversion manifest rules, no credits cutover, no admin UI, no checkout or Stripe work. `generate.ts` only chunks the `capacity_reservations` restaurant-id filter (100 ids per request) so a larger market does not put every id in one URL. Supply-gate scoring is unchanged.
