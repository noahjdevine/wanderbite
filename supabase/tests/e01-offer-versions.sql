-- E01 offer versions. Run after platform-prerequisites.sql and the E01 migration.
-- Each block is its own rolled-back transaction (test:db runs the full file in one psql session).

begin;
set local statement_timeout = '15s';

do $$
declare
  actor uuid := 'e0100000-0000-4000-8000-000000000001';
  member uuid := 'e0100000-0000-4000-8000-000000000002';
  restaurant uuid := 'e0100000-0000-4000-8000-000000000011';
  draft_id uuid;
  published jsonb;
  withdrawn jsonb;
  retired jsonb;
  version_id uuid;
  version_count integer;
  audit_count integer;
  pointer uuid;
  terms jsonb;
  paused text;
begin
  if has_table_privilege('anon', 'public.offer_versions', 'SELECT')
     or has_table_privilege('authenticated', 'public.offer_drafts', 'INSERT')
     or has_table_privilege('anon', 'public.offer_versions', 'INSERT')
     or has_table_privilege('authenticated', 'public.offer_versions', 'UPDATE')
     or has_function_privilege('anon', 'public.publish_offer_version(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.withdraw_offer_version(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('public', 'public.retire_restaurant(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.offer_version_terms_ok(jsonb, jsonb, text, timestamptz, timestamptz, text, text, integer)', 'EXECUTE')
  then
    raise exception 'FAIL: client roles can reach offer tables or functions';
  end if;

  if not has_function_privilege('service_role', 'public.publish_offer_version(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.withdraw_offer_version(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.retire_restaurant(uuid, uuid)', 'EXECUTE')
     or not has_table_privilege('service_role', 'public.offer_versions', 'SELECT')
     or not has_table_privilege('service_role', 'public.offer_drafts', 'INSERT')
     or not has_table_privilege('service_role', 'public.offer_drafts', 'UPDATE')
     or has_table_privilege('service_role', 'public.offer_versions', 'INSERT')
     or has_table_privilege('service_role', 'public.offer_versions', 'UPDATE')
     or has_table_privilege('service_role', 'public.offer_versions', 'DELETE')
  then
    raise exception 'FAIL: service_role offer grants are wrong';
  end if;

  insert into auth.users (id) values (actor), (member);
  insert into public.user_profiles (id, role) values (actor, 'admin'), (member, 'subscriber');
  insert into public.restaurants (id, name, status) values (restaurant, 'E01 Grill', 'paused');
  insert into public.offer_drafts (
    restaurant_id, timezone, valid_from, valid_until, tiers, boosts,
    capacity_timezone, capacity_window_kind, capacity_max_redemptions, boost_session_minutes
  ) values (
    restaurant, 'America/Chicago', now(), now() + interval '40 days',
    '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb,
    'America/Chicago', 'calendar_month', 50, 240
  ) returning id into draft_id;

  set local role service_role;

  begin
    insert into public.offer_versions (
      restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
      capacity_timezone, capacity_window_kind, capacity_max_redemptions
    ) values (
      restaurant, 'America/Chicago', now(), now() + interval '1 day', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
      'America/Chicago', 'calendar_month', 1
    );
    raise exception 'FAIL: service_role inserted a version directly';
  exception
    when insufficient_privilege then
      null;
  end;

  published := public.publish_offer_version(draft_id, member);
  if published ->> 'published' <> 'false' or published ->> 'error' <> 'not_admin' then
    raise exception 'FAIL: non-admin publish was accepted';
  end if;
  select count(*) into version_count from public.offer_versions where restaurant_id = restaurant;
  if version_count <> 0 then
    raise exception 'FAIL: rejected publish inserted a version';
  end if;

  published := public.publish_offer_version(draft_id, actor);
  if published ->> 'published' <> 'true' then
    raise exception 'FAIL: admin publish failed: %', published;
  end if;
  version_id := (published ->> 'version_id')::uuid;
  select current_offer_version_id into pointer from public.restaurants where id = restaurant;
  if pointer is distinct from version_id then
    raise exception 'FAIL: current pointer was not set';
  end if;
  select count(*) into audit_count
  from public.admin_audit_log
  where action = 'offer.publish' and target_id = version_id::text;
  if audit_count <> 1 then
    raise exception 'FAIL: offer.publish audit missing';
  end if;

  begin
    update public.offer_versions set tiers = '[]'::jsonb where id = version_id;
    raise exception 'FAIL: sealed terms were updated';
  exception
    when insufficient_privilege then
      null;
    when others then
      if sqlerrm not like '%sealed%' then
        raise;
      end if;
  end;

  select tiers into terms from public.offer_versions where id = version_id;
  withdrawn := public.withdraw_offer_version(version_id, actor);
  if withdrawn ->> 'withdrawn' <> 'true' then
    raise exception 'FAIL: withdraw failed: %', withdrawn;
  end if;
  if (select tiers from public.offer_versions where id = version_id) is distinct from terms then
    raise exception 'FAIL: withdraw changed terms';
  end if;
  if (select current_offer_version_id from public.restaurants where id = restaurant) is not null then
    raise exception 'FAIL: withdraw left the current pointer';
  end if;

  retired := public.retire_restaurant(restaurant, actor);
  if retired ->> 'result' <> 'paused' then
    raise exception 'FAIL: versioned restaurant was not paused: %', retired;
  end if;
  select status into paused from public.restaurants where id = restaurant;
  if paused <> 'paused' then
    raise exception 'FAIL: retire did not pause';
  end if;
end $$;

rollback;

begin;
set local statement_timeout = '15s';

do $$
declare
  actor uuid := 'e0100000-0000-4000-8000-000000000021';
  restaurant uuid := 'e0100000-0000-4000-8000-000000000031';
  draft_id uuid;
  version_count integer;
begin
  insert into auth.users (id) values (actor);
  insert into public.user_profiles (id, role) values (actor, 'admin');
  insert into public.restaurants (id, name, status) values (restaurant, 'E01 Audit', 'paused');
  insert into public.offer_drafts (
    restaurant_id, timezone, valid_from, valid_until, tiers, boosts,
    capacity_timezone, capacity_window_kind, capacity_max_redemptions
  ) values (
    restaurant, 'America/Chicago', now(), now() + interval '40 days',
    '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb,
    'America/Chicago', 'calendar_month', 10
  ) returning id into draft_id;

  alter table public.admin_audit_log
    add constraint e01_reject_publish check (action <> 'offer.publish');
  set local role service_role;
  begin
    perform public.publish_offer_version(draft_id, actor);
    raise exception 'FAIL: publish committed when audit was rejected';
  exception
    when others then
      if sqlerrm like '%publish committed%' then
        raise;
      end if;
  end;
  reset role;
  alter table public.admin_audit_log drop constraint e01_reject_publish;
  select count(*) into version_count from public.offer_versions where restaurant_id = restaurant;
  if version_count <> 0 then
    raise exception 'FAIL: audit failure left a version';
  end if;
  if (select current_offer_version_id from public.restaurants where id = restaurant) is not null then
    raise exception 'FAIL: audit failure left a pointer';
  end if;
end $$;

rollback;

begin;
set local statement_timeout = '15s';

do $$
declare
  actor uuid := 'e0100000-0000-4000-8000-000000000041';
  restaurant uuid := 'e0100000-0000-4000-8000-000000000051';
  draft_id uuid;
  published jsonb;
  version_count integer;
  version_id uuid;
  pointer uuid;
begin
  insert into auth.users (id) values (actor);
  insert into public.user_profiles (id, role) values (actor, 'admin');
  insert into public.restaurants (id, name, status) values (restaurant, 'E01 Floor', 'paused');

  if public.offer_version_terms_ok(
    '[{"threshold_cents":4000,"discount_cents":999}]'::jsonb,
    '[]'::jsonb,
    'America/Chicago',
    now(),
    now() + interval '40 days',
    'America/Chicago',
    'calendar_month',
    10
  ) is distinct from 'lowest_tier_below_credit_floor' then
    raise exception 'FAIL: offer_version_terms_ok did not refuse 999-cent tier';
  end if;
  if public.offer_version_terms_ok(
    '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb,
    '[]'::jsonb,
    'America/Chicago',
    now(),
    now() + interval '40 days',
    'America/Chicago',
    'calendar_month',
    10
  ) is not null then
    raise exception 'FAIL: offer_version_terms_ok refused 1000-cent tier';
  end if;

  insert into public.offer_drafts (
    restaurant_id, timezone, valid_from, valid_until, tiers, boosts,
    capacity_timezone, capacity_window_kind, capacity_max_redemptions
  ) values (
    restaurant, 'America/Chicago', now(), now() + interval '40 days',
    '[{"threshold_cents":4000,"discount_cents":999}]'::jsonb, '[]'::jsonb,
    'America/Chicago', 'calendar_month', 10
  ) returning id into draft_id;

  set local role service_role;
  published := public.publish_offer_version(draft_id, actor);
  if published ->> 'published' <> 'false'
     or published ->> 'error' <> 'lowest_tier_below_credit_floor' then
    raise exception 'FAIL: 999-cent draft publish was not refused: %', published;
  end if;
  select count(*) into version_count from public.offer_versions where restaurant_id = restaurant;
  if version_count <> 0 then
    raise exception 'FAIL: refused floor draft inserted a version';
  end if;

  update public.offer_drafts
  set tiers = '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb
  where id = draft_id;

  published := public.publish_offer_version(draft_id, actor);
  if published ->> 'published' <> 'true' then
    raise exception 'FAIL: 1000-cent draft publish failed: %', published;
  end if;
  version_id := (published ->> 'version_id')::uuid;
  select count(*) into version_count
  from public.offer_versions
  where restaurant_id = restaurant;
  if version_count <> 1 then
    raise exception 'FAIL: 1000-cent publish expected one offer_versions row, got %', version_count;
  end if;
  if not exists (select 1 from public.offer_versions where id = version_id) then
    raise exception 'FAIL: published version_id missing from offer_versions';
  end if;
  select current_offer_version_id into pointer from public.restaurants where id = restaurant;
  if pointer is distinct from version_id then
    raise exception 'FAIL: restaurants.current_offer_version_id does not match published version';
  end if;
end $$;

rollback;
