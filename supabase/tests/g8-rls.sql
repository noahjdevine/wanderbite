-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

do $$
declare
  extra text;
  missing text;
  view_cols text[];
  allowlist text[] := array[
    'id', 'name', 'slug', 'status', 'cuisine_tags', 'neighborhood', 'address',
    'description', 'price_range', 'image_url', 'google_photo_url', 'google_place_id',
    'is_dairy_free', 'is_vegan', 'is_halal'
  ];
begin
  if not (select relrowsecurity from pg_class where oid = 'public.restaurants'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.markets'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.restaurant_orgs'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.restaurant_offers'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.cron_runs'::regclass)
  then
    raise exception 'FAIL: G8 table RLS disabled';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('cron_runs', 'markets', 'restaurant_orgs', 'restaurant_offers')
  ) then
    raise exception 'FAIL: client policy exists on service-role-only G8 table';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'restaurants'
      and policyname = 'Public can read active restaurants'
      and cmd = 'SELECT'
  ) then
    raise exception 'FAIL: restaurants public SELECT policy missing';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.restaurants_public'::regclass
      and relkind = 'v'
      and coalesce(reloptions, '{}'::text[]) @> array['security_invoker=true']
  ) then
    raise exception 'FAIL: restaurants_public missing security_invoker=true';
  end if;

  select coalesce(array_agg(attname order by attname), '{}'::text[])
  into view_cols
  from pg_attribute
  where attrelid = 'public.restaurants_public'::regclass
    and attnum > 0
    and not attisdropped;

  if view_cols is distinct from (
    select array_agg(c order by c) from unnest(allowlist) as c
  ) then
    raise exception 'FAIL: restaurants_public columns % do not equal allowlist', view_cols;
  end if;

  if exists (
    select 1
    from aclexplode(coalesce((
      select relacl from pg_class where oid = 'public.cron_runs'::regclass
    ), '{}'::aclitem[])) acl
    where acl.grantee = 0
       or acl.grantee in ('anon'::regrole, 'authenticated'::regrole)
  ) then
    raise exception 'FAIL: client privileges remain on cron_runs';
  end if;

  if has_table_privilege('anon', 'public.cron_runs', 'SELECT')
    or has_table_privilege('anon', 'public.cron_runs', 'INSERT')
    or has_table_privilege('anon', 'public.cron_runs', 'UPDATE')
    or has_table_privilege('anon', 'public.cron_runs', 'DELETE')
    or has_table_privilege('authenticated', 'public.cron_runs', 'SELECT')
    or has_table_privilege('authenticated', 'public.cron_runs', 'INSERT')
    or has_table_privilege('authenticated', 'public.cron_runs', 'UPDATE')
    or has_table_privilege('authenticated', 'public.cron_runs', 'DELETE')
    or has_sequence_privilege('anon', 'public.cron_runs_id_seq', 'USAGE')
    or has_sequence_privilege('anon', 'public.cron_runs_id_seq', 'SELECT')
    or has_sequence_privilege('anon', 'public.cron_runs_id_seq', 'UPDATE')
    or has_sequence_privilege('authenticated', 'public.cron_runs_id_seq', 'USAGE')
    or has_sequence_privilege('authenticated', 'public.cron_runs_id_seq', 'SELECT')
    or has_sequence_privilege('authenticated', 'public.cron_runs_id_seq', 'UPDATE')
  then
    raise exception 'FAIL: client cron_runs table or sequence privilege remains';
  end if;

  if not has_table_privilege('service_role', 'public.cron_runs', 'SELECT')
    or not has_table_privilege('service_role', 'public.cron_runs', 'INSERT')
    or not has_table_privilege('service_role', 'public.cron_runs', 'UPDATE')
    or has_table_privilege('service_role', 'public.cron_runs', 'DELETE')
    or not has_sequence_privilege('service_role', 'public.cron_runs_id_seq', 'USAGE')
    or not has_sequence_privilege('service_role', 'public.cron_runs_id_seq', 'SELECT')
    or not has_sequence_privilege('service_role', 'public.cron_runs_id_seq', 'UPDATE')
  then
    raise exception 'FAIL: service_role cron_runs privileges are not the granted minimum';
  end if;

  if has_column_privilege('anon', 'public.restaurants', 'pin_hash', 'SELECT')
    or has_column_privilege('anon', 'public.restaurants', 'verification_code', 'SELECT')
    or has_column_privilege('authenticated', 'public.restaurants', 'pin_hash', 'SELECT')
    or has_column_privilege('authenticated', 'public.restaurants', 'verification_code', 'SELECT')
    or has_column_privilege('anon', 'public.restaurants', 'lat', 'SELECT')
    or has_column_privilege('authenticated', 'public.restaurants', 'org_id', 'SELECT')
  then
    raise exception 'FAIL: client SELECT remains on a secret or non-allowlist restaurant column';
  end if;

  if not has_column_privilege('anon', 'public.restaurants', 'name', 'SELECT')
    or not has_column_privilege('anon', 'public.restaurants', 'status', 'SELECT')
    or not has_column_privilege('anon', 'public.restaurants', 'slug', 'SELECT')
    or not has_column_privilege('service_role', 'public.restaurants', 'pin_hash', 'SELECT')
    or not has_column_privilege('service_role', 'public.restaurants', 'verification_code', 'SELECT')
  then
    raise exception 'FAIL: expected restaurant column privileges missing';
  end if;
end $$;

-- Hard-coded leftover + remaining table-level write grants after M5.
-- Named follow-up: revoke these leftovers and change ALTER DEFAULT PRIVILEGES.
-- Not computed from the live catalog; new role/table/write tuples must fail.
create temporary table g8_expected_table_writes (
  grantee text not null,
  table_name text not null,
  privilege_type text not null,
  primary key (grantee, table_name, privilege_type)
);
insert into g8_expected_table_writes (grantee, table_name, privilege_type)
select role_name, table_name, privilege_type
from (
  values
    ('anon'),
    ('authenticated')
) as roles (role_name)
cross join (
  values
    ('admin_audit_log'),
    ('badges'),
    ('bite_notes'),
    ('challenge_cycles'),
    ('challenge_items'),
    ('redemptions'),
    -- PostGIS catalog leftover in public; named follow-up, not an app table.
    ('spatial_ref_sys'),
    ('user_badges'),
    ('user_preferences')
) as leftover_tables (table_name)
cross join (
  values
    ('INSERT'),
    ('UPDATE'),
    ('DELETE')
) as writes (privilege_type);
insert into g8_expected_table_writes (grantee, table_name, privilege_type)
values
  ('anon', 'user_profiles', 'DELETE'),
  ('authenticated', 'user_profiles', 'DELETE');

create temporary table g8_expected_column_writes (
  grantee text not null,
  table_name text not null,
  column_name text not null,
  privilege_type text not null,
  primary key (grantee, table_name, column_name, privilege_type)
);
insert into g8_expected_column_writes (grantee, table_name, column_name, privilege_type)
select 'authenticated', 'user_profiles', column_name, 'INSERT'
from (
  values
    ('id'),
    ('email'),
    ('dietary_flags'),
    ('allergy_flags'),
    ('distance_band'),
    ('distance_preference'),
    ('wants_cocktail_experience'),
    ('full_name'),
    ('username'),
    ('phone_number'),
    ('address'),
    ('address_street'),
    ('address_city'),
    ('address_state'),
    ('address_zip')
) as cols (column_name);
insert into g8_expected_column_writes (grantee, table_name, column_name, privilege_type)
select 'authenticated', 'user_profiles', column_name, 'UPDATE'
from (
  values
    ('email'),
    ('dietary_flags'),
    ('allergy_flags'),
    ('distance_band'),
    ('distance_preference'),
    ('wants_cocktail_experience'),
    ('full_name'),
    ('username'),
    ('phone_number'),
    ('address'),
    ('address_street'),
    ('address_city'),
    ('address_state'),
    ('address_zip')
) as cols (column_name);

do $$
declare
  extra text;
  missing text;
begin
  select string_agg(format('%s.%s.%s', grantee, table_name, privilege_type), ', ' order by 1)
  into extra
  from (
    select
      case when acl.grantee = 0 then 'public' else acl.grantee::regrole::text end as grantee,
      c.relname as table_name,
      acl.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, '{}'::aclitem[])) acl
    where n.nspname = 'public'
      and c.relkind = 'r'
      and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and (acl.grantee = 0 or acl.grantee in ('anon'::regrole, 'authenticated'::regrole))
    except
    select grantee, table_name, privilege_type from g8_expected_table_writes
  ) added;

  select string_agg(format('%s.%s.%s', grantee, table_name, privilege_type), ', ' order by 1)
  into missing
  from (
    select grantee, table_name, privilege_type from g8_expected_table_writes
    except
    select
      case when acl.grantee = 0 then 'public' else acl.grantee::regrole::text end,
      c.relname,
      acl.privilege_type
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, '{}'::aclitem[])) acl
    where n.nspname = 'public'
      and c.relkind = 'r'
      and acl.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and (acl.grantee = 0 or acl.grantee in ('anon'::regrole, 'authenticated'::regrole))
  ) removed;

  if extra is not null then
    raise exception 'FAIL: added table-level write grant(s): %', extra;
  end if;
  if missing is not null then
    raise exception 'FAIL: missing expected table-level write grant(s): %', missing;
  end if;
end $$;

do $$
declare
  extra text;
  missing text;
begin
  select string_agg(
    format('%s.%s.%s.%s', grantee, table_name, column_name, privilege_type),
    ', ' order by 1
  )
  into extra
  from (
    select cp.grantee, cp.table_name, cp.column_name, cp.privilege_type
    from information_schema.column_privileges cp
    join pg_class c on c.relname = cp.table_name
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where cp.table_schema = 'public'
      and c.relkind = 'r'
      and cp.grantee in ('anon', 'authenticated', 'public')
      and cp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
      and not exists (
        select 1 from g8_expected_table_writes tw
        where tw.grantee = cp.grantee
          and tw.table_name = cp.table_name
          and tw.privilege_type = cp.privilege_type
      )
    except
    select grantee, table_name, column_name, privilege_type from g8_expected_column_writes
  ) added;

  select string_agg(
    format('%s.%s.%s.%s', grantee, table_name, column_name, privilege_type),
    ', ' order by 1
  )
  into missing
  from (
    select grantee, table_name, column_name, privilege_type from g8_expected_column_writes
    except
    select cp.grantee, cp.table_name, cp.column_name, cp.privilege_type
    from information_schema.column_privileges cp
    where cp.table_schema = 'public'
      and cp.grantee in ('anon', 'authenticated', 'public')
      and cp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) removed;

  if extra is not null then
    raise exception 'FAIL: added column-level write grant(s): %', extra;
  end if;
  if missing is not null then
    raise exception 'FAIL: missing expected column-level write grant(s): %', missing;
  end if;
end $$;

insert into public.markets (id, name, slug, status)
  values ('81000000-0000-4000-8000-000000000001', 'G8 Market', 'g8-market', 'active');
insert into public.restaurant_orgs (id, name, market_id)
  values ('82000000-0000-4000-8000-000000000001', 'G8 Org', '81000000-0000-4000-8000-000000000001');
insert into public.restaurants (
  id, org_id, market_id, name, slug, status, pin_hash, verification_code, cuisine_tags
) values
  (
    '80000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'G8 Active Grill',
    'g8-active',
    'active',
    'g8-pin-hash-active',
    'g8-verify-active',
    array['thai']
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'G8 Paused Pub',
    'g8-paused',
    'paused',
    'g8-pin-hash-paused',
    'g8-verify-paused',
    array['thai']
  );
insert into public.restaurant_offers (id, restaurant_id, active)
  values ('83000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', true);
insert into public.cron_runs (job_name, status)
  values ('g8-local-validation-only', 'success');

do $$
declare
  role_name text;
  rec record;
  changed integer;
  run_id bigint;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if role_name = 'authenticated' then
      perform set_config('request.jwt.claim.sub', '80000000-0000-4000-8000-000000000099', true);
    else
      perform set_config('request.jwt.claim.sub', '', true);
    end if;
    execute format('set local role %I', role_name);

    if (select count(*) from public.restaurants) <> 1
      or (select name from public.restaurants) is distinct from 'G8 Active Grill'
    then
      raise exception 'FAIL: % did not see exactly the active restaurant', role_name;
    end if;

    if exists (select 1 from public.restaurants where slug = 'g8-paused') then
      raise exception 'FAIL: % can see paused restaurants', role_name;
    end if;

    begin
      select * into rec from public.restaurants limit 1;
      raise exception 'FAIL: % SELECT * on restaurants was accepted', role_name;
    exception when insufficient_privilege then null; end;

    begin
      perform pin_hash from public.restaurants;
      raise exception 'FAIL: % SELECT pin_hash was accepted', role_name;
    exception when insufficient_privilege then null; end;

    begin
      perform verification_code from public.restaurants;
      raise exception 'FAIL: % SELECT verification_code was accepted', role_name;
    exception when insufficient_privilege then null; end;

    if (select count(*) from public.restaurants_public) <> 1
      or (select name from public.restaurants_public) is distinct from 'G8 Active Grill'
      or exists (select 1 from public.restaurants_public where slug = 'g8-paused')
    then
      raise exception 'FAIL: % restaurants_public did not return active rows only', role_name;
    end if;

    begin
      perform 1 from public.cron_runs;
      raise exception 'FAIL: % can read cron_runs', role_name;
    exception when insufficient_privilege then null; end;

    begin
      insert into public.restaurants (name) values ('g8-forged');
      raise exception 'FAIL: % insert into restaurants was accepted', role_name;
    exception when insufficient_privilege then null; end;

    begin
      update public.restaurants set name = 'forged';
      get diagnostics changed = row_count;
      if changed <> 0 then
        raise exception 'FAIL: % updated restaurants', role_name;
      end if;
    exception when insufficient_privilege then null; end;

    begin
      delete from public.restaurants;
      get diagnostics changed = row_count;
      if changed <> 0 then
        raise exception 'FAIL: % deleted restaurants', role_name;
      end if;
    exception when insufficient_privilege then null; end;

    begin
      perform 1 from public.markets;
      raise exception 'FAIL: % can read markets', role_name;
    exception when insufficient_privilege then null; end;

    begin
      insert into public.markets (name, slug) values ('forged', 'forged-market');
      raise exception 'FAIL: % insert into markets was accepted', role_name;
    exception when insufficient_privilege then null; end;

    begin
      update public.markets set name = 'forged';
      raise exception 'FAIL: % update markets was accepted', role_name;
    exception when insufficient_privilege then null; end;

    begin
      delete from public.markets;
      raise exception 'FAIL: % delete markets was accepted', role_name;
    exception when insufficient_privilege then null; end;

    begin
      perform 1 from public.restaurant_orgs;
      raise exception 'FAIL: % can read restaurant_orgs', role_name;
    exception when insufficient_privilege then null; end;

    begin
      insert into public.restaurant_orgs (name) values ('forged-org');
      raise exception 'FAIL: % insert into restaurant_orgs was accepted', role_name;
    exception when insufficient_privilege then null; end;

    begin
      update public.restaurant_orgs set name = 'forged';
      raise exception 'FAIL: % update restaurant_orgs was accepted', role_name;
    exception when insufficient_privilege then null; end;

    begin
      delete from public.restaurant_orgs;
      raise exception 'FAIL: % delete restaurant_orgs was accepted', role_name;
    exception when insufficient_privilege then null; end;

    begin
      perform 1 from public.restaurant_offers;
      raise exception 'FAIL: % can read restaurant_offers', role_name;
    exception when insufficient_privilege then null; end;

    begin
      insert into public.restaurant_offers (restaurant_id, active)
        values ('80000000-0000-4000-8000-000000000001', true);
      raise exception 'FAIL: % insert into restaurant_offers was accepted', role_name;
    exception when insufficient_privilege then null; end;

    begin
      update public.restaurant_offers set active = false;
      raise exception 'FAIL: % update restaurant_offers was accepted', role_name;
    exception when insufficient_privilege then null; end;

    begin
      delete from public.restaurant_offers;
      raise exception 'FAIL: % delete restaurant_offers was accepted', role_name;
    exception when insufficient_privilege then null; end;

    reset role;
  end loop;

  set local role service_role;

  if (select pin_hash from public.restaurants
        where id = '80000000-0000-4000-8000-000000000001')
       is distinct from 'g8-pin-hash-active'
    or (select count(*) from public.restaurants) <> 2
  then
    raise exception 'FAIL: service_role cannot read partner secrets or paused restaurants';
  end if;

  insert into public.restaurants (id, name, status, pin_hash)
    values ('80000000-0000-4000-8000-000000000003', 'G8 Service Write', 'paused', 'g8-pin-hash-write');
  update public.restaurants
    set name = 'G8 Service Updated'
    where id = '80000000-0000-4000-8000-000000000003';
  if not exists (
    select 1 from public.restaurants
    where id = '80000000-0000-4000-8000-000000000003'
      and name = 'G8 Service Updated'
      and status = 'paused'
      and pin_hash = 'g8-pin-hash-write'
  ) then
    raise exception 'FAIL: service_role restaurant write did not succeed';
  end if;

  insert into public.cron_runs (job_name, status)
    values ('g8-service-role-insert', 'running')
    returning id into run_id;
  if run_id is null then
    raise exception 'FAIL: service_role cron_runs insert did not allocate an id';
  end if;
  update public.cron_runs
    set status = 'success', finished_at = now()
    where id = run_id;
  if not exists (
    select 1 from public.cron_runs where id = run_id and status = 'success'
  ) then
    raise exception 'FAIL: service_role cron_runs update did not succeed';
  end if;

  insert into public.markets (name, slug) values ('G8 Service Market', 'g8-service-market');
  insert into public.restaurant_orgs (name)
    values ('G8 Service Org');
  insert into public.restaurant_offers (restaurant_id, active)
    values ('80000000-0000-4000-8000-000000000001', true);

  reset role;
end $$;

rollback;
select 'PASS: G8 restaurants/cron/markets/orgs/offers grants, invoker view, leftover write freeze, service-role writes; fixtures rolled back';
