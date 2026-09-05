-- TEST ONLY. The pinned official Supabase Postgres image supplies roles, auth.users,
-- auth.uid(), extensions and default grants. The Storage HTTP service is not started.
-- These minimal Storage relations supply only the fields referenced by migration
-- 025. This is a Postgres application-contract test, NOT a Storage/Auth API E2E test.
-- Never run this file against a hosted or application database.
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text
);
alter table storage.objects enable row level security;
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
grant all on storage.buckets, storage.objects to postgres, anon, authenticated, service_role;
-- Migration 025 needs to create policies as the table-owning Storage role.
grant supabase_storage_admin to postgres;

-- Explicitly reproduce the legacy public default grants observed on production.
-- This belongs ONLY in the isolated fixture, not in application migrations.
-- Do not use deprecated api.auto_expose_new_tables or change production grants.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
