# G1 local schema reconciliation and approval gates

## Scope and status

G1 is committed and pushed on `fix/ops-03-schema-reconciliation`. Commit
`092f93925042c13dc009b5b8ff81ec8ce4c96172` is based on
`886288b7adea6d474bd04ed41905101763dac403` and is under review in draft pull
request #16. The G0 checkout freeze is unchanged, and no website deployment or
package installation was performed as part of G1.

This is intended project documentation. The separate untracked `Docs/audit/`
and `supabase/.temp/` are not part of this change and must not be swept into a commit.

## Corrections

- `20260902225901_markets_slug_required.sql` brings fresh databases into line with
  production and the checked-in types: `markets.slug` is required. It does not
  change any URL. A database containing NULL slugs fails rather than receiving
  invented URLs. Lock acquisition is limited to five seconds, the statement to
  thirty seconds. Investigate a timeout; do not blindly increase these limits.
- `scripts/seed.ts` supplies `mckinney-tx`. This seed is NOT executed by tests; it
  loads application credentials and must not be run casually against production.
- `20260902225902_badge_icon_glyphs.sql` converts only known placeholder icon
  strings to glyphs consumed by the existing Journey text renderer. IDs, custom
  icons, descriptions, and earned awards are preserved. The original G1 seed is
  intentionally followed by a forward correction, not silently rewritten.
- The previous SQL-text search test was removed: matching a name in a comment
  or another table cannot establish the schema. `test:db` checks actual catalogs
  and executes constraints and access policies in PostgreSQL.

## Run the repeatable checks

Prerequisites: installed project dependencies, Docker's Linux engine running,
and the cached image `public.ecr.aws/supabase/postgres:17.6.1.134`.
No additional npm packages are needed. The runner uses `--pull=never`: if the
image is missing, stop and obtain approval before downloading it. It will not
install Docker, update the CLI, or download anything automatically.

From the website repository:

```sh
npm run test:db
```

Windows Docker Desktop is found on PATH or under
`%LOCALAPPDATA%/Programs/DockerDesktop/resources/bin`. If installed elsewhere,
set `G1_DOCKER_BIN` to the actual executable. Only these local Docker endpoints
are accepted through `G1_DOCKER_HOST`:

- Windows: `npipe:////./pipe/dockerDesktopLinuxEngine`
- Linux: `unix:///var/run/docker.sock`

There are no connection URL, hosted project, or migration repair arguments.
The app's `.env` files, Supabase link and application seed are never loaded.
An inherited Docker context/remote `DOCKER_HOST` cannot select a different target.

Every run creates a uniquely named `wanderbite-g1-test-<UUID>` container with
`--network=none`, no published ports, no host/persistent mounts, a tmpfs database,
and CPU/memory caps. It checks the exact ID, ownership label, mounts, and network
before use and cleanup. All SQL fixtures roll back. The container auto-removes
when stopped, discarding only that run's synthetic data. Existing containers and
volumes, including the earlier sibling practice environment, are untouched.
If interrupted or cleanup fails, inspect the exact printed test container name;
never use Docker-wide prune, `supabase stop --all`, or database reset to clean up.

The database image supplies actual Postgres, extensions, roles, `auth.users`,
and `auth.uid()`. The test-only platform fixture supplies minimal Storage
relations used by migration 025, because the Storage HTTP service is not started.
It explicitly reproduces this project's legacy grants without relying on the
deprecated `api.auto_expose_new_tables` setting. These fixture grants are not a
recommendation or migration for production. All app migrations execute as the
ordinary `postgres` migration role, not the bootstrap superuser.

## What the tests prove

- All 28 SQL migrations currently replay successfully from an empty app schema.
- Every column in all 14 contracted tables matches the checked-in Row, Insert,
  and Update types, including nullability and optionality from defaults.
- Slug omission, NULL insert/update, and duplicate URLs are rejected. Existing
  URLs survive the forward correction; pre-existing NULLs stop it safely.
- Badge glyphs match the text renderer; reapplying the correction preserves
  custom icons and existing awards.
- Badge/award/cron/audit RLS is enabled; badge catalogs are readable; two users'
  awards are isolated; member award mutations and forged cron inserts fail;
  anonymous/member cron reads are empty; service-role writes work.
- Award uniqueness/FKs, subscription status validation, caller-specific admin
  helper behavior, photo-bucket configuration and timestamp trigger are checked.
- The process rejects unsafe Docker endpoints/containers, and unit tests ensure
  nullability/default/type drift and comment-only schema claims are detected.

`.github/workflows/ci.yml` has a separate database-contract job. It prepares the
pinned image on an ephemeral GitHub runner, then runs exactly `npm run test:db`
without application secrets. The workflow is published on the G1 branch and is
triggered by pull request #16. Making it a required merge check is a separate
repository settings change requiring approval.

## Production reconciliation and verification

Project `yiajoycgiyxjvznndjge` was first inspected on 2 September 2026 with
SELECTs inside read-only transactions. No customer records or audit entries were
retrieved. Before any production write, schema equivalence and the minimum
aggregate backfill invariant were rechecked, a protected backup was restored in
an isolated local database, and the project owner was confirmed as recovery
owner.

- `markets.slug` is `text NOT NULL`, with no default. No production backfill is
  needed to add NOT NULL while this constraint remains in place.
- Migration history originally contained 001–017 and 021–024. Versions 025 and
  026 were absent even though their database objects already existed. After the
  equivalence checks passed, only the 025/026 history entries were reconciled as
  applied.
- **025:** bucket name/public flag/5 MiB limit/JPEG-PNG-WebP types, all three
  Storage policies (including roles and predicates), nullable restaurant
  `updated_at DEFAULT now()`, trigger event/body and function configuration match
  the migration. No extra Storage object policies were observed. The historical
  `updated_at` data backfill cannot be proved by metadata alone; no row scan was
  performed in this metadata-only inspection.
- **026:** all seven column types/nullability/defaults, sequence, PK, validated
  `auth.users` FK with DELETE RESTRICT, three secondary indexes, table comment,
  enabled RLS and the single authenticated admin-read policy match the file.
  Existing broad legacy grants remain; this is not a permissions-hardening pass.

### Completed production sequence

1. The 025/026 schema-equivalence checks and minimum aggregate backfill check
   passed immediately before the history change.
2. A protected backup and isolated restore rehearsal were verified, with the
   project owner confirmed as recovery owner.
3. Only migration-history entries 025 and 026 were marked as applied, and the
   resulting history was verified before G1 continued.
4. The five reviewed G1 migrations were applied together in one guarded
   transaction with their matching history entries. The operation did not
   reapply 025/026 or include unrelated migrations.
5. Postflight verification found exactly 28 expected migration-history rows and
   confirmed the structured address columns/index, subscription constraints,
   badge policies and glyphs, cron RLS, and required market slug. Checkout stayed
   fail-closed throughout; no website deployment was performed.

## Boundaries and remaining uncertainty

This is a real Postgres app-contract suite, not the full Supabase CLI platform
reset, Auth/Storage HTTP test, generated relationship/RPC-type comparison, or
browser/Stripe E2E suite. The pinned local PG17.6 image and hosted PG17.6 image
have different build revisions. A new project using restrictive default grants
needs its own deliberate grant review; this suite models the existing project's
legacy grants. It does not resolve SEC-01 or certify overall security/launch readiness.

Do not rerun vanilla `supabase start`/`db reset` in the old sibling practice
folder: the earlier CLI setup exposed broad bindings. The new `test:db` runner
does not use that folder and has no network bindings at all.

## Verification results for this local implementation

- `npm run lint`: PASS, zero errors and seven existing script console warnings.
- `npx --no-install tsc --noEmit`: PASS.
- `npm test`: PASS, 64 tests across eight files, including the unchanged G0 tests.
- `npm run test:db`: PASS on two fresh disposable databases; the final run also
  verifies preservation of an already-earned badge and its award timestamp.
- `npm run build`: PASS. The sandboxed attempt could not fetch the existing
  Outfit Google Font; the approved network-enabled retry succeeded. Build-only
  process variables disabled checkout and Sentry uploads and supplied dummy
  service credentials. No environment file was edited. Existing middleware,
  edge-runtime static-generation and Node deprecation warnings remain.
- `git diff --check`: PASS. New G1 files were also checked for trailing whitespace.
- No disposable test containers remain. The existing sibling practice database
  is still on `127.0.0.1:55432`; its data and containers were not changed.
- G1 implementation commit
  `092f93925042c13dc009b5b8ff81ec8ce4c96172` and this documentation follow-up
  are pushed on `origin/fix/ops-03-schema-reconciliation`, the head branch for
  draft pull request #16. Checkout/billing/challenges/onboarding sources,
  `.env.example`, checkout-hold documentation and historical migrations
  001/003/025/026 are unchanged.

The first harness attempts caught a Docker tmpfs metadata assumption and a
test-only Storage ownership mismatch. Both were fixed; failed run containers
were disposed of without touching existing databases.

### Complete G1 working-tree file manifest

The G1 implementation commit contains the 19 project files below. In particular,
`src/types/database.types.ts`, `src/lib/schema-contract.ts`, and the badge/cron
initial G1 migrations were preserved; the existing contract test and profile
migration comment were refined.

```text
.github/workflows/ci.yml
README.md
package.json
scripts/seed.ts
scripts/database-contract.ts
scripts/test-database.ts
src/types/database.types.ts
src/lib/schema-contract.ts
src/lib/schema-contract.test.ts
src/lib/database-validation.test.ts
supabase/migrations/20260902195734_user_profiles_billing_admin_address.sql
supabase/migrations/20260902195736_badges_and_user_badges.sql
supabase/migrations/20260902195738_cron_runs_enable_rls.sql
supabase/migrations/20260902225901_markets_slug_required.sql
supabase/migrations/20260902225902_badge_icon_glyphs.sql
supabase/tests/platform-prerequisites.sql
supabase/tests/g1-acceptance.sql
supabase/tests/g1-rls.sql
Docs/g1-database-validation.md
```

Explicitly excluded and untouched: `Docs/audit/`, `supabase/.temp/`.

References: [Supabase database testing](https://supabase.com/docs/guides/database/testing),
[PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html),
[Supabase local migrations](https://supabase.com/docs/guides/local-development/database-migrations).
