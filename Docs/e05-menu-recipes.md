# E05-B public-menu recipe drafts

Operator-only. This does not change member pages. A member sees a row only after it is published and both `E05_RECIPES_ENABLED` and, for Discover answers, `E05_RECIPE_QA_ENABLED` are exactly `true`. Those flags stay unset in this slice.

The script reads one allowlisted public menu URL per restaurant and asks Claude Haiku `claude-haiku-4-5-20251001` (the same snapshot and Messages API as Discover) for paraphrased inspired-by home recipes. It does not reserve or settle a member AI budget. It does not write credits, offers, challenges, verified visits, badges, or drawings.

Default mode is `--dry-run`. It writes JSON under `.menu-recipes/` (gitignored) and prints a summary: restaurant, dishes found, drafts made, and skips. It does not write the database.

## Registry

`scripts/fixtures/e05-menu-sources.json` maps `restaurant_slug` to one `https` menu URL plus notes. The slug must match `restaurants.slug` before `--apply`. The script fetches only those URLs. It will not accept `--url`. It does not follow links or redirects, log in, or read PDFs or images. OCR is out of scope.

Before each page it fetches that origin's `robots.txt`. If the file disallows the menu path for `WanderbiteMenuDraftBot`, the restaurant is skipped and the page is not fetched. Requests are about one per second, with a 10s timeout and a 1 MB cap. The user agent is `WanderbiteMenuDraftBot/1.0`.

A JavaScript-only menu will not extract. Paste the visible menu text and run `--from-file` instead. That path makes no network call. The file must stay inside the repo, and `--slug` must be one registry slug. `source_url` is still the registry URL. `retrieved_at` is the time the file was read.

## Draft rows

Each kept draft is `recipe_type = inspired_by`, `source_kind = public_menu`, `menu_wording = paraphrase`, `rights_basis = original`, `is_demo = false`, and `visibility = draft`. `source_url` is the menu URL. `retrieved_at` is the fetch time, stored as UTC and shown on the card in America/Chicago. The description is a paraphrase. A description that repeats the menu description or shares a six-word run with the menu prose is skipped. Dietary notes that say allergen-safe, allergy-safe, or safe for someone are skipped. Menu text is sent to the model inside `BEGIN_UNTRUSTED_MENU_DATA` and is not stored.

The existing card copy stays “An at-home take, not the restaurant's recipe.” The source link uses the label “Public menu”.

Caps: 5 restaurants per run and 5 dishes per restaurant. The summary prints estimated input and output tokens. Reported token counts are printed when the model returns them.

## Apply and publish

`--apply` and `--publish` are local unless Noah has separately approved a hosted run.

```bash
npm run menu:recipes -- --help
npm run menu:recipes -- --slug hutchins-bbq
npm run menu:recipes -- --from-file .menu-recipes/menu.txt --slug hutchins-bbq
WANDERBITE_MENU_RECIPES_APPLY=1 npm run menu:recipes -- --apply --slug hutchins-bbq
WANDERBITE_MENU_RECIPES_APPLY=1 npm run menu:recipes -- --publish <uuid>,<uuid>
```

`--apply` inserts with the service role. A second run with the same restaurant, menu URL, and dish title does not insert another row. `--publish` sets `visibility` to `published` and `checked_at` to the review time, and only for an unpublished `public_menu` inspired-by draft that already has `source_url` and `retrieved_at`.

The script refuses the hosted project and any `supabase.co` URL unless `WANDERBITE_MENU_RECIPES_HOSTED_OK=1` is set for that run. Do not set that variable unless Noah has approved the hosted write. Ordinary review uses a local database.

## Rollback

Revert this PR. Delete applied rows where `source_kind = 'public_menu'`. That delete is local unless Noah approved a hosted apply. There is no migration.

```sql
delete from public.recipes where source_kind = 'public_menu';
```
