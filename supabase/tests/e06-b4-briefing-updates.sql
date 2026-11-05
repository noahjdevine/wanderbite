-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E06-B4: restaurant_page, briefing subject, grants, apply refuses to activate,
-- conflict opens an exception, and rollback keeps history.
begin;
set local statement_timeout = '15s';

insert into public.restaurants (id, name, status) values
  ('e06b4000-0000-4000-8000-000000000010', 'E06 Briefing Refresh', 'active');

insert into public.content_sources (id, kind, url, restaurant_id, status, notes)
values (
  'e06b4000-0000-4000-8000-000000000020',
  'restaurant_page',
  'https://example.com/e06b4-official',
  'e06b4000-0000-4000-8000-000000000010',
  'active',
  'Local briefing refresh fixture.'
);

insert into public.restaurant_briefing_facts (
  id, restaurant_id, field, body, source_url, last_verified_at, status, is_sample, version
) values (
  'e06b4000-0000-4000-8000-000000000030',
  'e06b4000-0000-4000-8000-000000000010',
  'parking',
  'Street parking is two blocks east.',
  'https://example.com/e06b4-official',
  now(),
  'paused',
  false,
  1
), (
  'e06b4000-0000-4000-8000-000000000031',
  'e06b4000-0000-4000-8000-000000000010',
  'arrival',
  'Use the front door on the square.',
  'https://example.com/e06b4-official',
  now(),
  'active',
  false,
  1
);

insert into public.source_facts (
  id, source_id, subject_type, subject_id, field, value, evidence_excerpt, version, status
) values (
  'e06b4000-0000-4000-8000-000000000040',
  'e06b4000-0000-4000-8000-000000000020',
  'briefing',
  'e06b4000-0000-4000-8000-000000000010',
  'parking',
  '{"text":"Street parking is two blocks east."}'::jsonb,
  'Street parking is two blocks east.',
  1,
  'pending_review'
);

do $$
begin
  if has_table_privilege('anon', 'public.content_sources', 'INSERT')
    or has_table_privilege('authenticated', 'public.content_sources', 'INSERT')
    or has_table_privilege('anon', 'public.source_facts', 'INSERT')
    or has_table_privilege('authenticated', 'public.source_facts', 'INSERT')
    or has_table_privilege('anon', 'public.content_exceptions', 'INSERT')
    or has_table_privilege('authenticated', 'public.content_exceptions', 'INSERT')
    or has_table_privilege('anon', 'public.restaurant_briefing_facts', 'INSERT')
    or has_table_privilege('authenticated', 'public.restaurant_briefing_facts', 'UPDATE')
    or has_function_privilege('anon', 'public.apply_briefing_field_fact(uuid, uuid, text, jsonb, text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.apply_briefing_field_fact(uuid, uuid, text, jsonb, text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.rollback_briefing_field_fact(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.rollback_briefing_field_fact(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.decide_briefing_fact(uuid, text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.decide_briefing_fact(uuid, text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.publish_briefing_fact(uuid, uuid, text, text, text, boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.publish_briefing_fact(uuid, uuid, text, text, text, boolean)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.apply_briefing_field_fact(uuid, uuid, text, jsonb, text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.rollback_briefing_field_fact(uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.decide_briefing_fact(uuid, text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.publish_briefing_fact(uuid, uuid, text, text, text, boolean)', 'EXECUTE') then
    raise exception 'FAIL: briefing update grants';
  end if;

  begin
    insert into public.content_sources (kind, url, status, notes)
    values ('restaurant_page', 'https://example.com/e06b4-missing-restaurant', 'active', 'missing restaurant');
    raise exception 'FAIL: restaurant_page without restaurant_id was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.content_sources (kind, url, status, notes)
    values ('partnership', 'https://example.com/e06b4-bad-kind', 'active', 'bad kind');
    raise exception 'FAIL: kind partnership was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.source_facts (
      source_id, subject_type, subject_id, field, value, evidence_excerpt, version, status
    ) values (
      'e06b4000-0000-4000-8000-000000000020',
      'offer',
      'e06b4000-0000-4000-8000-000000000010',
      'parking',
      '{"text":"no"}'::jsonb,
      'no',
      9,
      'pending_review'
    );
    raise exception 'FAIL: subject_type offer was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.content_exceptions (source_id, subject_type, reason)
    values (
      'e06b4000-0000-4000-8000-000000000020',
      'booking',
      'sensitive'
    );
    raise exception 'FAIL: exception subject_type booking was accepted';
  exception when check_violation then null; end;

  insert into public.content_exceptions (
    source_id, subject_type, subject_id, field, reason, before, after, evidence_excerpt
  ) values (
    'e06b4000-0000-4000-8000-000000000020',
    'briefing',
    'e06b4000-0000-4000-8000-000000000010',
    'duration',
    'sensitive',
    '{"text":"About an hour."}'::jsonb,
    null,
    'About an hour.'
  );
  if not exists (
    select 1 from public.content_exceptions
    where subject_type = 'briefing' and field = 'duration' and status = 'open'
  ) then
    raise exception 'FAIL: briefing subject_type was refused';
  end if;
end $$;

set local role anon;
do $$
begin
  begin
    perform public.apply_briefing_field_fact(
      'e06b4000-0000-4000-8000-000000000020',
      'e06b4000-0000-4000-8000-000000000010',
      'parking',
      '{"text":"Valet parking is available beside the front door."}'::jsonb,
      'Valet parking is available beside the front door.'
    );
    raise exception 'FAIL: anon applied a briefing draft';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.restaurant_briefing_facts (
      restaurant_id, field, body, source_url, last_verified_at
    ) values (
      'e06b4000-0000-4000-8000-000000000010',
      'attire',
      'Jackets are not required.',
      'https://example.com/e06b4-official',
      now()
    );
    raise exception 'FAIL: anon inserted a briefing fact';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;

do $$
declare
  v_offers integer;
  v_versions integer;
  v_credits integer;
  v_items integer;
  v_redemptions integer;
  v_draft uuid;
  v_rolled uuid;
  v_published uuid;
  v_rows integer;
begin
  select count(*) into v_offers from public.restaurant_offers;
  select count(*) into v_versions from public.offer_versions;
  select count(*) into v_credits from public.entitlement_credits;
  select count(*) into v_items from public.challenge_items;
  select count(*) into v_redemptions from public.redemptions;

  v_draft := public.apply_briefing_field_fact(
    'e06b4000-0000-4000-8000-000000000020',
    'e06b4000-0000-4000-8000-000000000010',
    'parking',
    '{"text":"Valet parking is available beside the front door.","before":"Street parking is two blocks east."}'::jsonb,
    'Valet parking is available beside the front door.'
  );
  if v_draft is null then
    raise exception 'FAIL: paused briefing draft was not recorded';
  end if;
  if (select status from public.restaurant_briefing_facts where id = 'e06b4000-0000-4000-8000-000000000030')
      is distinct from 'paused'
    or (select body from public.restaurant_briefing_facts where id = 'e06b4000-0000-4000-8000-000000000030')
      is distinct from 'Street parking is two blocks east.' then
    raise exception 'FAIL: apply changed a paused fact or activated it';
  end if;
  if (select status from public.source_facts where id = v_draft) is distinct from 'pending_review'
    or (select value ->> 'text' from public.source_facts where id = v_draft)
      is distinct from 'Valet parking is available beside the front door.' then
    raise exception 'FAIL: briefing draft was not pending_review';
  end if;

  if public.apply_briefing_field_fact(
    'e06b4000-0000-4000-8000-000000000020',
    'e06b4000-0000-4000-8000-000000000010',
    'arrival',
    '{"text":"The side gate opens onto the patio."}'::jsonb,
    'The side gate opens onto the patio.'
  ) is not null then
    raise exception 'FAIL: apply wrote a fact over an active row';
  end if;
  if (select status from public.restaurant_briefing_facts where id = 'e06b4000-0000-4000-8000-000000000031')
      is distinct from 'active'
    or (select body from public.restaurant_briefing_facts where id = 'e06b4000-0000-4000-8000-000000000031')
      is distinct from 'Use the front door on the square.' then
    raise exception 'FAIL: apply changed an active member fact';
  end if;
  if not exists (
    select 1 from public.content_exceptions
    where subject_type = 'briefing'
      and field = 'arrival'
      and reason = 'conflict'
      and status = 'open'
      and before ->> 'text' = 'Use the front door on the square.'
      and after ->> 'text' = 'The side gate opens onto the patio.'
  ) then
    raise exception 'FAIL: active briefing change did not open a conflict';
  end if;
  if exists (
    select 1 from public.source_facts
    where subject_type = 'briefing' and field = 'arrival' and status = 'pending_review'
  ) then
    raise exception 'FAIL: conflict also wrote a briefing draft';
  end if;

  v_rolled := public.rollback_briefing_field_fact(v_draft);
  select count(*) into v_rows
  from public.source_facts
  where source_id = 'e06b4000-0000-4000-8000-000000000020'
    and subject_type = 'briefing'
    and field = 'parking';
  if v_rows < 3
    or not exists (
      select 1 from public.source_facts
      where id = 'e06b4000-0000-4000-8000-000000000040'
    )
    or (select status from public.source_facts where id = v_draft) is distinct from 'superseded'
    or (select status from public.source_facts where id = v_rolled) is distinct from 'pending_review'
    or (select value ->> 'text' from public.source_facts where id = v_rolled)
      is distinct from 'Street parking is two blocks east.' then
    raise exception 'FAIL: briefing rollback did not keep history';
  end if;
  if (select status from public.restaurant_briefing_facts where field = 'parking' and restaurant_id = 'e06b4000-0000-4000-8000-000000000010')
    is distinct from 'paused' then
    raise exception 'FAIL: rollback activated a briefing fact';
  end if;

  perform public.decide_briefing_fact(v_rolled, 'approve');
  if (select status from public.source_facts where id = v_rolled) is distinct from 'reviewed'
    or (select status from public.restaurant_briefing_facts where id = 'e06b4000-0000-4000-8000-000000000030')
      is distinct from 'paused'
    or (select body from public.restaurant_briefing_facts where id = 'e06b4000-0000-4000-8000-000000000030')
      is distinct from 'Street parking is two blocks east.' then
    raise exception 'FAIL: approve published a briefing fact';
  end if;

  v_published := public.publish_briefing_fact(
    'e06b4000-0000-4000-8000-000000000020',
    'e06b4000-0000-4000-8000-000000000010',
    'duration',
    'Most dinners last about 90 minutes.',
    'Most dinners last about 90 minutes.',
    true
  );
  if (select status from public.restaurant_briefing_facts
      where restaurant_id = 'e06b4000-0000-4000-8000-000000000010' and field = 'duration')
    is distinct from 'paused' then
    raise exception 'FAIL: publish activated a new briefing fact';
  end if;
  if public.publish_briefing_fact(
    'e06b4000-0000-4000-8000-000000000020',
    'e06b4000-0000-4000-8000-000000000010',
    'parking',
    'A lot sits behind the building.',
    'A lot sits behind the building.',
    true
  ) is null
    or (select status from public.restaurant_briefing_facts where id = 'e06b4000-0000-4000-8000-000000000030')
      is distinct from 'paused' then
    raise exception 'FAIL: publish activated a paused briefing fact';
  end if;
  if (select count(*) from public.source_facts
      where subject_type = 'briefing' and field = 'parking' and value ->> 'text' = 'Street parking is two blocks east.')
    < 1
    or (select body from public.restaurant_briefing_facts where id = 'e06b4000-0000-4000-8000-000000000030')
      is distinct from 'A lot sits behind the building.' then
    raise exception 'FAIL: publish dropped briefing history';
  end if;

  if v_published is null
    or (select count(*) from public.restaurant_offers) <> v_offers
    or (select count(*) from public.offer_versions) <> v_versions
    or (select count(*) from public.entitlement_credits) <> v_credits
    or (select count(*) from public.challenge_items) <> v_items
    or (select count(*) from public.redemptions) <> v_redemptions then
    raise exception 'FAIL: briefing update wrote an offer, credit, challenge, or redemption';
  end if;
end $$;

reset role;
rollback;
select 'PASS: E06-B4 briefing kind, subject, grants, paused drafts, conflict, and rollback history; fixtures rolled back';
