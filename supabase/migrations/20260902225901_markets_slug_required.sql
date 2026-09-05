-- OPS-03: production and the application already require markets.slug.
-- Do not invent/backfill URLs. If another environment has NULL slugs, stop and
-- request an explicitly reviewed mapping before applying this migration there.
-- Let the migration runner own the transaction so the schema change and its
-- migration-history entry commit together. Direct psql replay must use -1 -f.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.markets alter column slug set not null;
