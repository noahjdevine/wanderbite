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

`--resolve` marks an open row `approved` or `rejected`. It does not publish. The admin screen that can publish a description is E05-B3.

## Admin review

`/admin/content` is an operator page behind `assertAdmin` (role plus current session `aal2`). A signed-in member, or an admin who has not finished MFA, is refused before any pipeline read or write. The queue lists open `content_exceptions`, newest source attempt first, filtered by reason. Each row shows the restaurant, the source URL, the reason, before, after, a short evidence excerpt, last attempted and last verified in America/Chicago, and the linked recipe and fact version. Evidence and after text render as plain text. This view does not send that text to a model.

The refresh opens conflicts on price and ingredients, and rows for a missing dish, sensitive price, hours, dietary or allergen text, injection, or a failed paraphrase. Approve marks those rows reviewed and publishes nothing. Approving again returns "Already resolved." and writes nothing. Edit publishes the operator's paraphrase through `apply_recipe_description_fact` when it is non-empty, at most 400 characters, and not a copy of the menu. That call bumps `recipes.version` and keeps the prior fact. `menu_wording` and `visibility` are not changed. Reject marks the row rejected and writes no recipe or fact. Rollback on a recipe's history calls `rollback_recipe_to_previous` and does not call `rollback_content_fact`. Each of those actions writes one `admin_audit_log` row. Sources can be paused or resumed. There is no form to add a URL.

## Scheduled refresh

`GET /api/cron/content-refresh` uses the same bearer cron auth as the other cron routes. Unless `E05_CONTENT_REFRESH_CRON_ENABLED` is exactly `true`, it returns `{ status: 'disabled', skipped: true }` and writes no attempt. When the flag is on, `runLeasedCron` holds job `content-refresh` for the America/Chicago date. A second overlapping call gets `lease-held` and does no work. The run calls the existing refresh with apply semantics, at most 5 sources and 15 attempts, and reserves the G13-A maintenance budget. A denied or exhausted budget records the attempt, skips the model, and leaves published descriptions as they were. A byte-identical page records `unchanged` and does not call the model. A failed fetch advances `last_attempted_at` and does not advance `last_verified_at`. Per-source outcomes are `cron_run_items` rows. `vercel.json` schedules this path at `0 9 * * *` UTC. Unsetting the flag stops the scheduled refresh without a code deploy.

Rollback inserts the previous value as a new version and supersedes the current row. It does not delete history and it does not change `saved_recipes.recipe_version`.

Listed timestamps use America/Chicago. Stored timestamps are UTC.

## Hosted

Local review uses a local database. The script refuses a hosted Supabase URL unless `WANDERBITE_CONTENT_REFRESH_HOSTED_OK=1`. Writes also need `WANDERBITE_CONTENT_REFRESH_APPLY=1`. Migration `20261104040000_e05_b2_content_pipeline.sql` was applied to the hosted database on 2026-11-03 with Noah's OK, and its `schema_migrations` version is aligned. Do not run `npm run types:db` against hosted for this slice; the checked-in table types were hand-edited to match the migration.

## Rollback of the PR

Revert the PR. The migration only adds tables. A later forward migration can drop them. Do not edit an applied migration. Nothing in this PR is applied to hosted.
