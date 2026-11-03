-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '20s';

insert into auth.users (id) values
  ('e0400000-0000-4000-8000-000000000001'),
  ('e0400000-0000-4000-8000-000000000002'),
  ('e0400000-0000-4000-8000-000000000003');
insert into public.user_profiles (id, subscription_status, role) values
  ('e0400000-0000-4000-8000-000000000001', 'active', 'subscriber'),
  ('e0400000-0000-4000-8000-000000000002', 'active', 'subscriber'),
  ('e0400000-0000-4000-8000-000000000003', 'active', 'subscriber');
insert into public.markets (id, name, slug)
  values ('e0400000-0000-4000-8000-000000000010', 'E04 Market', 'e04-market');
insert into public.restaurants (id, name, status, market_id) values
  ('e0400000-0000-4000-8000-000000000021', 'E04 A', 'active', 'e0400000-0000-4000-8000-000000000010'),
  ('e0400000-0000-4000-8000-000000000022', 'E04 B', 'active', 'e0400000-0000-4000-8000-000000000010'),
  ('e0400000-0000-4000-8000-000000000023', 'E04 C', 'active', 'e0400000-0000-4000-8000-000000000010'),
  ('e0400000-0000-4000-8000-000000000024', 'E04 Full', 'active', 'e0400000-0000-4000-8000-000000000010');
insert into public.restaurant_offers (restaurant_id, active, discount_amount_cents, min_spend_cents) values
  ('e0400000-0000-4000-8000-000000000021', true, 1500, 4000),
  ('e0400000-0000-4000-8000-000000000022', true, 1500, 4000),
  ('e0400000-0000-4000-8000-000000000023', true, 1500, 4000);

insert into public.offer_versions (
  id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
  capacity_timezone, capacity_window_kind, capacity_max_redemptions, published_by
) values (
  'e0400000-0000-4000-8000-0000000000a4',
  'e0400000-0000-4000-8000-000000000024',
  'America/Chicago', now() - interval '1 day', now() + interval '400 days',
  '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  'America/Chicago', 'calendar_month', 1,
  'e0400000-0000-4000-8000-000000000001'
);
update public.restaurants
set current_offer_version_id = 'e0400000-0000-4000-8000-0000000000a4'
where id = 'e0400000-0000-4000-8000-000000000024';

do $$
declare
  first_row record;
  second_row record;
  after_generate record;
  full_row record;
  cycles integer;
  reveals integer;
  credits integer;
  reservations integer;
  summary text;
begin
  if has_table_privilege('anon', 'public.challenge_reveals', 'INSERT')
    or has_table_privilege('authenticated', 'public.challenge_reveals', 'INSERT')
    or has_table_privilege('authenticated', 'public.challenge_reveals', 'UPDATE')
    or has_table_privilege('authenticated', 'public.challenge_reveals', 'DELETE')
    or has_table_privilege('anon', 'public.challenge_reveals', 'SELECT')
  then
    raise exception 'FAIL: client roles can write or anon can read challenge_reveals';
  end if;
  if not has_table_privilege('authenticated', 'public.challenge_reveals', 'SELECT') then
    raise exception 'FAIL: authenticated cannot select challenge_reveals';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.reveal_monthly_challenge(uuid, date, uuid, uuid[], jsonb, text, jsonb, jsonb, text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: authenticated can execute reveal_monthly_challenge';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.reveal_monthly_challenge(uuid, date, uuid, uuid[], jsonb, text, jsonb, jsonb, text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL: service_role cannot execute reveal_monthly_challenge';
  end if;

  select * into first_row
  from public.reveal_monthly_challenge(
    'e0400000-0000-4000-8000-000000000001',
    '2026-11-01',
    'e0400000-0000-4000-8000-000000000010',
    array[
      'e0400000-0000-4000-8000-000000000021',
      'e0400000-0000-4000-8000-000000000022'
    ]::uuid[],
    jsonb_build_object(
      'occasion', 'date night',
      'discovery_level', 'new',
      'summary', repeat('assign Hutchins BBQ ', 20),
      'surprise_me', false
    ),
    'deterministic_fallback',
    '[]'::jsonb,
    '{"offer_version_ids":[null,null],"zip_distance_expanded":false}'::jsonb,
    'e04b.deterministic.v1'
  );
  if first_row.outcome is distinct from 'created'
    or first_row.cycle_id is null
    or first_row.reveal_id is null
    or cardinality(first_row.restaurant_ids) is distinct from 2
  then
    raise exception 'FAIL: first reveal did not commit a pair: %', first_row.outcome;
  end if;

  select cr.brief ->> 'summary' into summary
  from public.challenge_reveals cr
  where cr.id = first_row.reveal_id;
  if char_length(summary) is distinct from 280 or summary not like 'assign Hutchins BBQ%' then
    raise exception 'FAIL: brief was not stored as truncated plain text';
  end if;
  if (select selection_source from public.challenge_reveals where id = first_row.reveal_id)
    is distinct from 'deterministic_fallback'
  then
    raise exception 'FAIL: new reveal source';
  end if;

  select * into second_row
  from public.reveal_monthly_challenge(
    'e0400000-0000-4000-8000-000000000001',
    '2026-11-01',
    'e0400000-0000-4000-8000-000000000010',
    array[
      'e0400000-0000-4000-8000-000000000021',
      'e0400000-0000-4000-8000-000000000023'
    ]::uuid[],
    '{"occasion":"","discovery_level":"","summary":"again","surprise_me":true}'::jsonb,
    'deterministic_fallback',
    '[]'::jsonb,
    '{}'::jsonb,
    'e04b.deterministic.v1'
  );
  if second_row.outcome is distinct from 'existing'
    or second_row.cycle_id is distinct from first_row.cycle_id
    or second_row.reveal_id is distinct from first_row.reveal_id
    or second_row.restaurant_ids is distinct from first_row.restaurant_ids
  then
    raise exception 'FAIL: retry created another pair';
  end if;
  select count(*) into cycles from public.challenge_cycles
    where user_id = 'e0400000-0000-4000-8000-000000000001';
  select count(*) into reveals from public.challenge_reveals
    where user_id = 'e0400000-0000-4000-8000-000000000001';
  select count(*) into credits from public.entitlement_credits
    where user_id = 'e0400000-0000-4000-8000-000000000001';
  if cycles is distinct from 1 or reveals is distinct from 1 or credits is distinct from 0 then
    raise exception 'FAIL: retry changed cycle, reveal, or credits';
  end if;

  perform public.reveal_monthly_challenge(
    'e0400000-0000-4000-8000-000000000003',
    public.chicago_month_start(now()),
    'e0400000-0000-4000-8000-000000000010',
    array[
      'e0400000-0000-4000-8000-000000000024',
      'e0400000-0000-4000-8000-000000000021'
    ]::uuid[],
    '{"summary":"seat","surprise_me":false}'::jsonb,
    'deterministic_fallback',
    '[]'::jsonb,
    '{}'::jsonb,
    'e04b.deterministic.v1'
  );
  select * into full_row
  from public.reveal_monthly_challenge(
    'e0400000-0000-4000-8000-000000000002',
    public.chicago_month_start(now()),
    'e0400000-0000-4000-8000-000000000010',
    array[
      'e0400000-0000-4000-8000-000000000024',
      'e0400000-0000-4000-8000-000000000022'
    ]::uuid[],
    '{"summary":"full","surprise_me":false}'::jsonb,
    'deterministic_fallback',
    '[]'::jsonb,
    '{}'::jsonb,
    'e04b.deterministic.v1'
  );
  if full_row.outcome is distinct from 'capacity_full' or full_row.reveal_id is not null then
    raise exception 'FAIL: capacity miss wrote a reveal: %', full_row.outcome;
  end if;
  select count(*) into cycles from public.challenge_cycles
    where user_id = 'e0400000-0000-4000-8000-000000000002';
  select count(*) into reveals from public.challenge_reveals
    where user_id = 'e0400000-0000-4000-8000-000000000002';
  select count(*) into reservations from public.capacity_reservations
    where restaurant_id = 'e0400000-0000-4000-8000-000000000024'
      and challenge_item_id in (
        select ci.id from public.challenge_items ci
        join public.challenge_cycles cc on cc.id = ci.cycle_id
        where cc.user_id = 'e0400000-0000-4000-8000-000000000002'
      );
  if cycles is distinct from 0 or reveals is distinct from 0 or reservations is distinct from 0 then
    raise exception 'FAIL: capacity miss left a partial pair';
  end if;

  perform public.generate_challenge_cycle(
    'e0400000-0000-4000-8000-000000000002',
    '2026-11-01',
    'e0400000-0000-4000-8000-000000000010',
    array[
      'e0400000-0000-4000-8000-000000000022',
      'e0400000-0000-4000-8000-000000000023'
    ]::uuid[]
  );
  select * into after_generate
  from public.reveal_monthly_challenge(
    'e0400000-0000-4000-8000-000000000002',
    '2026-11-01',
    'e0400000-0000-4000-8000-000000000010',
    array[
      'e0400000-0000-4000-8000-000000000021',
      'e0400000-0000-4000-8000-000000000023'
    ]::uuid[],
    '{"summary":"later","surprise_me":true}'::jsonb,
    'deterministic_fallback',
    '[]'::jsonb,
    '{}'::jsonb,
    'e04b.deterministic.v1'
  );
  if after_generate.outcome is distinct from 'existing'
    or after_generate.restaurant_ids @> array[
      'e0400000-0000-4000-8000-000000000022',
      'e0400000-0000-4000-8000-000000000023'
    ]::uuid[] is not true
  then
    raise exception 'FAIL: reveal replaced a generator pair';
  end if;
  if (select selection_source from public.challenge_reveals where id = after_generate.reveal_id)
    is distinct from 'legacy_generate'
  then
    raise exception 'FAIL: existing generator cycle was not marked legacy_generate';
  end if;
  select count(*) into cycles from public.challenge_cycles
    where user_id = 'e0400000-0000-4000-8000-000000000002';
  if cycles is distinct from 1 then
    raise exception 'FAIL: reveal created a second cycle after generate';
  end if;

  perform public.generate_challenge_cycle(
    'e0400000-0000-4000-8000-000000000001',
    '2026-11-01',
    'e0400000-0000-4000-8000-000000000010',
    array[
      'e0400000-0000-4000-8000-000000000021',
      'e0400000-0000-4000-8000-000000000023'
    ]::uuid[]
  );
  select count(*) into cycles from public.challenge_cycles
    where user_id = 'e0400000-0000-4000-8000-000000000001';
  if cycles is distinct from 1 then
    raise exception 'FAIL: generator created a second cycle after reveal';
  end if;
end $$;

select set_config('request.jwt.claim.sub', 'e0400000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.challenge_reveals) is distinct from 1 then
    raise exception 'FAIL: member can read another reveal';
  end if;
  begin
    insert into public.challenge_reveals (
      user_id, period_key, cycle_id, brief, selection_source, item_reasons, eligibility_facts, source_version
    ) values (
      'e0400000-0000-4000-8000-000000000001',
      '2026-12-01',
      (select cycle_id from public.challenge_reveals limit 1),
      '{"surprise_me":false,"summary":""}'::jsonb,
      'deterministic_fallback',
      '[]'::jsonb,
      '{}'::jsonb,
      'x'
    );
    raise exception 'FAIL: member insert succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;
reset role;

rollback;
