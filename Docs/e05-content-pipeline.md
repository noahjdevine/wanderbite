# E05-B2 content pipeline

Operator-only. This does not change member pages. `E05_RECIPES_ENABLED` and `E05_RECIPE_QA_ENABLED` stay unset. The runner does not write credits, offers, offer versions, challenges, verified visits, XP, badges, or drawings.

`npm run menu:recipes` remains the one-shot draft script from #88. `npm run content:refresh` is the shared maintenance pipeline E06-B can extend. A new command keeps the one-shot flags from gaining a second write path.

## Registry

`content_sources` holds approved URLs. `kind` may be `public_menu`, `venue_page`, `event_page`, or `restaurant_page`. This runner fetches all four. `public_menu` behavior is unchanged. `venue_page` and `event_page` are activity sources. `restaurant_page` is an https official site for a first-visit refresh and requires `restaurant_id`. `status` is `active`, `paused`, or `retired`. A row that is missing or not active is refused.

The two #88 URLs are not inserted by SQL. Register them from `scripts/fixtures/e05-menu-sources.json`:

```bash
npm run content:refresh -- --register
WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --register --apply
npm run content:refresh -- --register --registry scripts/fixtures/e06-activity-sources.json
```

The activity fixture is fictional `example.com` pages. It does not insert activities and it is not a partnership.

## Refresh

Default `--refresh` is a dry-run. It does not write attempts, facts, exceptions, or recipes, and it does not call the model. `--apply` writes.

```bash
npm run content:refresh -- --sources
npm run content:refresh -- --refresh
npm run content:refresh -- --refresh --source <uuid>
npm run content:refresh -- --expire
WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --expire --apply
npm run content:refresh -- --refresh --from-file .menu-recipes/menu.html --source <uuid>
WANDERBITE_CONTENT_REFRESH_APPLY=1 npm run content:refresh -- --refresh --apply
```

Fetch reuses the #88 robots check, allowlist, 10s timeout, 1 MB cap, and `WanderbiteMenuDraftBot` user agent. Redirects are refused. Page HTML is not stored. The page is hashed with SHA-256.

A byte-identical page records `source_fetch_attempts.outcome = unchanged`, advances `last_attempted_at` and `last_verified_at`, and does not call the model. That includes `venue_page` and `event_page`.

A venue or event page does not insert an activity. Hours, price, and allergen text open `content_exceptions` (`sensitive` or `conflict`) and are not written onto the activity. A summary draft on `--apply` is a `pending_review` fact for an activity that already exists. It uses the same G13-A maintenance ledger. The draft value includes `change_summary` (at most 160 characters) from that same model call, or a one-line fallback when the model omits a sentence the page supports. An open `pending_review` row for the same activity and summary text is not inserted again. It cannot invent a partnership, booking, discount, credit, or offer. The activity row is not rewritten by that draft.

`--expire` lists active activities whose `valid_until` is before today's America/Chicago date. Dry-run prints the rows and writes nothing. `--apply` sets `status` to `expired`. It does not delete rows and it does not change challenges, redemptions, or offers.

A timeout, HTTP error, robots disallow, oversize body, or refused redirect records that outcome, advances `last_attempted_at`, and does not advance `last_verified_at`. Timeout and HTTP errors retry at most twice, with 250ms backoff doubling each time. One run checks at most 5 sources and 15 attempts.

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

Apply calls Claude Haiku `claude-haiku-4-5-20251001` only when a description change still needs a paraphrase, or when an activity page still needs a summary draft. A dry-run does not call it. Each call reserves G13-A maintenance (`ai_reserve`, `feature_class = maintenance`, `account_tier = ops`, no `user_id` and no `guest_id`), then dispatches and settles. That is the operating ledger. It is not a member AI budget. No new ledger table was added. One run reserves at most one call per source, and at most 5 sources.

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

The same page lists activity rows, labeled Activity. An open `content_exceptions` row with `subject_type = 'activity'` shows the activity name, field, https source URL, checked time in America/Chicago, before, after, and the stored evidence excerpt as plain text. The page does not fetch that URL. A `source_facts` summary with `subject_type = 'activity'` and `status = 'pending_review'` is a queue item too. Approve marks that draft `reviewed` and does not make it current. Edit on that draft calls `publish_activity_summary`: the operator's text is a new `current` version and the prior row stays. Reject sets the draft to `rejected`. None of those summary actions change the activity row. Edit on an `hours_note` exception calls `publish_activity_hours_note`, which sets `activities.hours_note` to the typed text, increments `version`, and keeps the previous note as a superseded fact. Price and allergen activity rows (field `price`, or field `description` for a dietary claim) are not published as a fact or written onto the activity. Edit only resolves them and stores the operator's note on the audit row, the same way a recipe price or allergen conflict is never published as a claim. `E06_ACTIVITIES_ENABLED` stays unset, so members do not see the activity.

The same page lists briefing rows, labeled Briefing. Approve marks the draft or exception reviewed and publishes nothing. Edit is the only path that writes `restaurant_briefing_facts`. A new or paused fact stays paused. An already-active fact stays active only when the operator keeps it visible. A pending briefing draft and a pending activity summary show `change_summary` as plain text beside the current and proposed text. Evidence stays plain text. Checked times stay America/Chicago. `E06_BRIEFINGS_ENABLED` stays unset.

## Scheduled refresh

`GET /api/cron/content-refresh` uses the same bearer cron auth as the other cron routes. Unless `E05_CONTENT_REFRESH_CRON_ENABLED` is exactly `true`, it returns `{ status: 'disabled', skipped: true }` and writes no attempt. When the flag is on, `runLeasedCron` holds job `content-refresh` for the America/Chicago date. A second overlapping call gets `lease-held` and does no work. The run calls the existing refresh with apply semantics, at most 5 sources and 15 attempts, and reserves the G13-A maintenance budget. A denied or exhausted budget records the attempt, skips the model, and leaves published descriptions as they were. A byte-identical page records `unchanged` and does not call the model. A failed fetch advances `last_attempted_at` and does not advance `last_verified_at`. Per-source outcomes are `cron_run_items` rows. `vercel.json` schedules this path at `0 9 * * *` UTC, which is 03:00 America/Chicago in standard time and 04:00 in daylight time. That schedule is unchanged. Unsetting the flag stops the scheduled refresh without a code deploy.

`E06_ACTIVITY_MAINTENANCE_CRON_ENABLED` is a second exact-string flag. Unset, empty, or any value other than `true`, the cron does not query `activities` and does not select `venue_page` or `event_page` sources. The response matches the menu-only run. It also stays disabled when `E05_CONTENT_REFRESH_CRON_ENABLED` is not `true`, even if the activity flag is `true`. When both flags are `true`, the same run expires active activities whose `valid_until` is before today's America/Chicago date (`expire_dated_activities`). A row dated today stays active. A null `valid_until` stays active. Rows are not deleted. It then refreshes due activity sources: `event_page` when `last_verified_at` is null or older than 1 day of elapsed time, `venue_page` when null or older than 7 days. That cadence is elapsed milliseconds, not a Chicago calendar day, so a daylight-saving day does not shorten it. Due rows are oldest `last_verified_at` first, nulls first, then id.

The per-run cap is shared, not doubled. Active `public_menu` rows keep their current share: they are chosen first, in URL order, up to 5. Due activity sources fill only the slots those menus leave, and only when `E06_ACTIVITY_MAINTENANCE_CRON_ENABLED` is exactly `true`. Due `restaurant_page` sources fill only the slots left after that. A `restaurant_page` is due when `last_verified_at` is null or older than 7 elapsed days, the same cadence as `venue_page`. A run that already has 5 active menus does not fetch an activity source or a restaurant page. No new flag and no new `vercel.json` schedule are required for that page: it runs when `E05_CONTENT_REFRESH_CRON_ENABLED` is exactly `true`. The 15-attempt cap and the one model call per source (at most 5) follow that same order. A restaurant page is extracted from the fetched text only. A grounded difference from a paused fact is a `pending_review` briefing draft and does not set `restaurant_briefing_facts.status` to `active`. That draft carries `change_summary`. The same normalized text does not insert a second open draft. Conflicts, removed evidence, sensitive claims, and injection-suspected text open `content_exceptions` and do not write the fact. Hours, price, and allergen text still open `content_exceptions` and are not written onto the activity. A summary draft stays a `pending_review` fact. The cron does not insert an activity, partnership, booking, discount, credit, or offer, and it does not write challenges, redemptions, or offers. If the activities table, `content_source_id`, or `expire_dated_activities` is missing, the activity step logs one skip (`activity maintenance skipped: activities schema unavailable`) and the menu step still runs. Unsetting `E06_ACTIVITY_MAINTENANCE_CRON_ENABLED` stops that step without a code deploy. Leave the flag unset.

Rollback inserts the previous value as a new version and supersedes the current row. It does not delete history and it does not change `saved_recipes.recipe_version`.

Listed timestamps use America/Chicago. Stored timestamps are UTC.

## Hosted

Local review uses a local database. The script refuses a hosted Supabase URL unless `WANDERBITE_CONTENT_REFRESH_HOSTED_OK=1`. Writes also need `WANDERBITE_CONTENT_REFRESH_APPLY=1`. Do not point refresh or expire at hosted. Migration `20261104040000_e05_b2_content_pipeline.sql` was applied to the hosted database on 2026-11-03 with Noah's OK, and its `schema_migrations` version is aligned. Migration `20261105193652_e06_b1_activity_pipeline.sql` is applied to hosted (2026-11-05). The filename matches the hosted `schema_migrations` version. Do not run `npm run types:db` against hosted for this slice; the checked-in table types were hand-edited to match the migration.

## Rollback of the PR

Revert the PR. The migration only adds tables. A later forward migration can drop them. Do not edit an applied migration. Nothing in this PR is applied to hosted.
