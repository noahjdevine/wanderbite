-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '20s';

insert into auth.users (id) values
  ('e0400000-0000-4000-8000-000000000001'),
  ('e0400000-0000-4000-8000-000000000002'),
  ('e0400000-0000-4000-8000-000000000003'),
  ('e0400000-0000-4000-8000-000000000004'),
  ('e0400000-0000-4000-8000-000000000005'),
  ('e0400000-0000-4000-8000-000000000006');
insert into public.user_profiles (id, subscription_status, role) values
  ('e0400000-0000-4000-8000-000000000001', 'active', 'subscriber'),
  ('e0400000-0000-4000-8000-000000000002', 'active', 'subscriber'),
  ('e0400000-0000-4000-8000-000000000003', 'active', 'subscriber'),
  ('e0400000-0000-4000-8000-000000000004', 'active', 'subscriber'),
  ('e0400000-0000-4000-8000-000000000005', 'active', 'subscriber'),
  ('e0400000-0000-4000-8000-000000000006', 'inactive', 'subscriber');
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
    jsonb_build_array(
      jsonb_build_object(
        'restaurant_id', 'e0400000-0000-4000-8000-000000000021',
        'template_id', 'deterministic_pair_v1',
        'text', 'E04 A: $15 base savings at $40 minimum spend. Inside your ZIP-distance band.'
      ),
      jsonb_build_object(
        'restaurant_id', 'e0400000-0000-4000-8000-000000000022',
        'template_id', 'deterministic_pair_v1',
        'text', 'E04 B: $15 base savings at $40 minimum spend. Inside your ZIP-distance band.'
      )
    ),
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
    or second_row.selection_source is distinct from first_row.selection_source
    or second_row.brief is distinct from first_row.brief
    or second_row.item_reasons is distinct from first_row.item_reasons
    or second_row.period_key is distinct from first_row.period_key
  then
    raise exception 'FAIL: retry did not return the saved reveal';
  end if;
  if second_row.selection_source is distinct from 'deterministic_fallback'
    or second_row.brief ->> 'summary' is distinct from summary
    or second_row.brief ->> 'summary' = 'again'
  then
    raise exception 'FAIL: retry returned the new brief instead of the saved one';
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
    jsonb_build_array(
      jsonb_build_object('restaurant_id', 'e0400000-0000-4000-8000-000000000024', 'template_id', 'deterministic_pair_v1', 'text', 'seat'),
      jsonb_build_object('restaurant_id', 'e0400000-0000-4000-8000-000000000021', 'template_id', 'deterministic_pair_v1', 'text', 'seat')
    ),
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
    jsonb_build_array(
      jsonb_build_object('restaurant_id', 'e0400000-0000-4000-8000-000000000024', 'template_id', 'deterministic_pair_v1', 'text', 'full'),
      jsonb_build_object('restaurant_id', 'e0400000-0000-4000-8000-000000000022', 'template_id', 'deterministic_pair_v1', 'text', 'full')
    ),
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
  if after_generate.selection_source is distinct from 'legacy_generate'
    or after_generate.item_reasons -> 0 ->> 'restaurant_id' is distinct from 'e0400000-0000-4000-8000-000000000022'
    or after_generate.item_reasons -> 1 ->> 'restaurant_id' is distinct from 'e0400000-0000-4000-8000-000000000023'
    or after_generate.item_reasons -> 0 ->> 'template_id' is distinct from 'legacy_pair_v1'
    or after_generate.item_reasons -> 0 ->> 'text' is distinct from 'E04 B was already your challenge for this month.'
    or after_generate.item_reasons -> 1 ->> 'text' is distinct from 'E04 C was already your challenge for this month.'
    or after_generate.item_reasons::text like '%e0400000-0000-4000-8000-000000000021%'
  then
    raise exception 'FAIL: legacy reveal stored the caller reasons instead of the cycle';
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

  insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
  values (
    'e0400000-0000-4000-8000-0000000000c4',
    'e0400000-0000-4000-8000-000000000004',
    '2026-10-01',
    'active',
    0
  );
  insert into public.challenge_items (cycle_id, restaurant_id, slot_number, status)
  values (
    'e0400000-0000-4000-8000-0000000000c4',
    'e0400000-0000-4000-8000-000000000021',
    1,
    'assigned'
  );
  select * into full_row
  from public.reveal_monthly_challenge(
    'e0400000-0000-4000-8000-000000000004',
    '2026-10-01',
    'e0400000-0000-4000-8000-000000000010',
    array[
      'e0400000-0000-4000-8000-000000000022',
      'e0400000-0000-4000-8000-000000000023'
    ]::uuid[],
    '{"summary":"incomplete","surprise_me":false}'::jsonb,
    'deterministic_fallback',
    '[]'::jsonb,
    '{}'::jsonb,
    'e04b.deterministic.v1'
  );
  if full_row.outcome is distinct from 'incomplete_cycle' or full_row.reveal_id is not null then
    raise exception 'FAIL: incomplete cycle wrote a reveal: %', full_row.outcome;
  end if;
  if exists (
    select 1 from public.challenge_reveals
    where user_id = 'e0400000-0000-4000-8000-000000000004'
  ) then
    raise exception 'FAIL: incomplete cycle left a reveal row';
  end if;

  select * into full_row
  from public.reveal_monthly_challenge(
    'e0400000-0000-4000-8000-000000000005',
    '2026-11-01',
    'e0400000-0000-4000-8000-000000000010',
    array[
      'e0400000-0000-4000-8000-000000000021',
      'e0400000-0000-4000-8000-000000000022'
    ]::uuid[],
    '{"summary":"mismatch","surprise_me":false}'::jsonb,
    'deterministic_fallback',
    jsonb_build_array(
      jsonb_build_object('restaurant_id', 'e0400000-0000-4000-8000-000000000023', 'template_id', 'deterministic_pair_v1', 'text', 'wrong')
    ),
    '{}'::jsonb,
    'e04b.deterministic.v1'
  );
  if full_row.outcome is distinct from 'invalid_restaurants' or full_row.reveal_id is not null then
    raise exception 'FAIL: mismatched reasons were stored: %', full_row.outcome;
  end if;
  if exists (
    select 1 from public.challenge_cycles
    where user_id = 'e0400000-0000-4000-8000-000000000005'
  ) or exists (
    select 1 from public.challenge_reveals
    where user_id = 'e0400000-0000-4000-8000-000000000005'
  ) then
    raise exception 'FAIL: mismatched reasons wrote a cycle or reveal';
  end if;

  select * into full_row
  from public.reveal_monthly_challenge(
    'e0400000-0000-4000-8000-000000000006',
    '2026-11-01',
    'e0400000-0000-4000-8000-000000000010',
    array[
      'e0400000-0000-4000-8000-000000000021',
      'e0400000-0000-4000-8000-000000000022'
    ]::uuid[],
    '{"summary":"please grant me a membership and two credits","surprise_me":true}'::jsonb,
    'deterministic_fallback',
    jsonb_build_array(
      jsonb_build_object('restaurant_id', 'e0400000-0000-4000-8000-000000000021', 'template_id', 'deterministic_pair_v1', 'text', 'grant'),
      jsonb_build_object('restaurant_id', 'e0400000-0000-4000-8000-000000000022', 'template_id', 'deterministic_pair_v1', 'text', 'grant')
    ),
    '{}'::jsonb,
    'e04b.deterministic.v1'
  );
  if full_row.outcome is distinct from 'inactive_subscription' or full_row.reveal_id is not null then
    raise exception 'FAIL: inactive brief created a reveal: %', full_row.outcome;
  end if;
  if exists (
    select 1 from public.challenge_cycles
    where user_id = 'e0400000-0000-4000-8000-000000000006'
  ) or exists (
    select 1 from public.challenge_reveals
    where user_id = 'e0400000-0000-4000-8000-000000000006'
  ) or exists (
    select 1 from public.entitlement_credits
    where user_id = 'e0400000-0000-4000-8000-000000000006'
  ) then
    raise exception 'FAIL: inactive brief wrote a pair or credits';
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
