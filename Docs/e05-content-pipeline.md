# E05-B2 content pipeline

Operator-only. This does not change member pages. `E05_RECIPES_ENABLED` and `E05_RECIPE_QA_ENABLED` stay unset. The runner does not write credits, offers, offer versions, challenges, verified visits, XP, badges, or drawings.

`npm run menu:recipes` remains the one-shot draft script from #88. `npm run content:refresh` is the shared maintenance pipeline E06-B can extend. A new command keeps the one-shot flags from gaining a second write path.

## Registry

`content_sources` holds approved URLs. `kind` may be `public_menu`, `venue_page`, or `event_page`. This runner fetches `public_menu` only. `status` is `active`, `paused`, or `retired`. A row that is missing or not active is refused.

The two #88 URLs are not inserted by SQL. Register them from `scripts/fixtures/e05-menu-sources.json`:

```bash
npm run content:refresh -- --register
WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --register --apply
```

## Refresh

Default `--refresh` is a dry-run. It does not write attempts, facts, exceptions, or recipes, and it does not call the model. `--apply` writes.

```bash
npm run content:refresh -- --sources
npm run content:refresh -- --refresh
npm run content:refresh -- --refresh --source <uuid>
npm run content:refresh -- --refresh --from-file .menu-recipes/menu.html --source <uuid>
WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --refresh --apply
```

Fetch reuses the #88 robots check, allowlist, 10s timeout, 1 MB cap, and `WanderbiteMenuDraftBot` user agent. Redirects are refused. Page HTML is not stored. The page is hashed with SHA-256.

A byte-identical page records `source_fetch_attempts.outcome = unchanged`, advances `last_attempted_at` and `last_verified_at`, and does not call the model. A timeout, HTTP error, robots disallow, oversize body, or refused redirect records that outcome, advances `last_attempted_at`, and does not advance `last_verified_at`. Timeout and HTTP errors retry at most twice, with 250ms backoff doubling each time. One run checks at most 5 sources and 15 attempts.

The first refresh of a source that already has inspired-by `public_menu` recipes writes their baseline facts automatically. A separate command would be easy to skip, and this refresh is the one that stores the page hash. Skipping the facts there would make the next identical fetch look unchanged and leave the #88 rows untracked.

On `--apply`, each matched recipe with no current description fact gets one `source_facts` row. `version` is `recipes.version`, not a fresh 1, so a member who saved that recipe before the fact existed still resolves. The fact text is the recipe's current description. The menu description, price, and ingredients are what later checks compare. There is no model call and the recipe row does not change. A recipe whose normalized title does not match one extracted dish, including a #88 title that ends with the dish name, opens `missing_source`. Dishes with no recipe are ignored. Running it again does not insert a second current fact.

When the hash changes, deterministic rules run before any publish:

- A changed dish description may update the matching inspired-by draft or published row once. `recipes.version` bumps. The prior `source_facts` row stays `superseded`, so `saved_recipes.recipe_version` still resolves that text.
- A price or ingredient list that contradicts the current fact opens `content_exceptions` with reason `conflict`, including before, after, and a short evidence excerpt. Nothing is published.
- A removed dish opens reason `missing_source`. The existing recipe is not deleted or rewritten.
- Prices, hours, and dietary or allergen claims open reason `sensitive` and are not published.
- Text that tells the model to ignore instructions, publish all, or mark `restaurant_approved` opens reason `injection_suspected`. The recipe stays `inspired_by` and draft. Menu text sent to the model stays inside `BEGIN_UNTRUSTED_MENU_DATA`.

Re-running the same bytes records `unchanged` and does not create another fact version.

A description change supersedes the old fact, inserts the new one, and bumps `recipes.version` in one database call (`apply_recipe_description_fact`). A failure leaves the current fact and the recipe version as they were. `rollback_content_fact` refuses a recipe description and tells the operator to use `rollback_recipe_to_previous`, which bumps the fact and the recipe together. If the model call throws after the maintenance reservation is dispatched, the run marks that reservation assumed spent.

## Model budget

Apply calls Claude Haiku `claude-haiku-4-5-20251001` only when a description change still needs a paraphrase. Each call reserves G13-A maintenance (`ai_reserve`, `feature_class = maintenance`, `account_tier = ops`, no `user_id` and no `guest_id`), then dispatches and settles. That is the operating ledger. It is not a member AI budget. No new ledger table was added. One run reserves at most one call per source, and at most 5 sources.

## Exceptions and rollback

```bash
npm run content:refresh -- --exceptions
WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --resolve <uuid> approve
WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --resolve <uuid> reject
WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --rollback fact <uuid>
WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --rollback recipe <uuid>
```

`--resolve` marks an open row `approved` or `rejected`. It does not publish. The admin screen that edits a row is E05-B3.

Rollback inserts the previous value as a new version and supersedes the current row. It does not delete history and it does not change `saved_recipes.recipe_version`.

Listed timestamps use America/Chicago. Stored timestamps are UTC.

## Hosted

Local review uses a local database. The script refuses a hosted Supabase URL unless `WANDERBITE_CONTENT_REFRESH_HOSTED_OK=1`. Writes also need `WANDERBITE_CONTENT_REFRESH_APPLY=1`. Migration `20261104040000_e05_b2_content_pipeline.sql` is not on hosted. Noah runs `supabase db push` only after a separate OK. Do not run `npm run types:db` against hosted for this slice; the checked-in table types were hand-edited to match the migration.

## Rollback of the PR

Revert the PR. The migration only adds tables. A later forward migration can drop them. Do not edit an applied migration. Nothing in this PR is applied to hosted.
