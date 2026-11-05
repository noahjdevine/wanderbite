-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E06-B5: change_summary is stored, a matching open draft is not inserted again,
-- a different text still versions, and an active conflict still opens an exception.
begin;
set local statement_timeout = '15s';

insert into public.restaurants (id, name, status) values
  ('e06b5000-0000-4000-8000-000000000010', 'E06 Draft Summary', 'active');

insert into public.content_sources (id, kind, url, restaurant_id, status, notes)
values (
  'e06b5000-0000-4000-8000-000000000020',
  'restaurant_page',
  'https://example.com/e06b5-official',
  'e06b5000-0000-4000-8000-000000000010',
  'active',
  'Local draft summary fixture.'
), (
  'e06b5000-0000-4000-8000-000000000021',
  'venue_page',
  'https://example.com/e06b5-venue',
  null,
  'active',
  'Local activity summary fixture.'
);

insert into public.restaurant_briefing_facts (
  id, restaurant_id, field, body, source_url, last_verified_at, status, is_sample, version
) values (
  'e06b5000-0000-4000-8000-000000000030',
  'e06b5000-0000-4000-8000-000000000010',
  'parking',
  'Street parking is two blocks east.',
  'https://example.com/e06b5-official',
  now(),
  'paused',
  false,
  1
), (
  'e06b5000-0000-4000-8000-000000000031',
  'e06b5000-0000-4000-8000-000000000010',
  'arrival',
  'Use the front door on the square.',
  'https://example.com/e06b5-official',
  now(),
  'active',
  false,
  1
);

insert into public.activities (
  id, name, category, source_url, content_source_id, lat, lon, zip,
  cost_category, status, booking_required, is_sample
) values (
  'e06b5000-0000-4000-8000-000000000040',
  'Sample Square Walk',
  'walk',
  'https://example.com/e06b5-venue',
  'e06b5000-0000-4000-8000-000000000021',
  33.2, -96.6, '75069',
  'free',
  'active',
  false,
  true
);

set local role service_role;

do $$
declare
  v_offers integer;
  v_credits integer;
  v_items integer;
  v_redemptions integer;
  v_draft uuid;
  v_again uuid;
  v_next uuid;
  v_activity uuid;
  v_activity_again uuid;
  v_summary text;
  v_pending integer;
  v_long text;
begin
  select count(*) into v_offers from public.restaurant_offers;
  select count(*) into v_credits from public.entitlement_credits;
  select count(*) into v_items from public.challenge_items;
  select count(*) into v_redemptions from public.redemptions;
  v_long := repeat('Valet parking changed beside the front door. ', 8);

  v_draft := public.apply_briefing_field_fact(
    'e06b5000-0000-4000-8000-000000000020',
    'e06b5000-0000-4000-8000-000000000010',
    'parking',
    jsonb_build_object(
      'text', 'Valet parking is available beside the front door.',
      'before', 'Street parking is two blocks east.',
      'change_summary', v_long
    ),
    'Valet parking is available beside the front door.'
  );
  select value ->> 'change_summary' into v_summary
  from public.source_facts
  where id = v_draft;
  if v_draft is null
    or (select status from public.source_facts where id = v_draft) is distinct from 'pending_review'
    or v_summary is null
    or char_length(v_summary) > 160
    or right(v_summary, 1) is distinct from '…'
    or (select status from public.restaurant_briefing_facts where id = 'e06b5000-0000-4000-8000-000000000030')
      is distinct from 'paused' then
    raise exception 'FAIL: briefing draft did not store a capped change_summary as pending_review';
  end if;

  v_again := public.apply_briefing_field_fact(
    'e06b5000-0000-4000-8000-000000000020',
    'e06b5000-0000-4000-8000-000000000010',
    'parking',
    '{"text":"Valet   parking is available beside the front door.","change_summary":"different"}'::jsonb,
    'Valet parking is available beside the front door.'
  );
  select count(*) into v_pending
  from public.source_facts
  where subject_type = 'briefing'
    and subject_id = 'e06b5000-0000-4000-8000-000000000010'
    and field = 'parking'
    and status = 'pending_review';
  if v_again is distinct from v_draft
    or v_pending <> 1
    or (select status from public.source_facts where id = v_draft) is distinct from 'pending_review'
    or (select value ->> 'change_summary' from public.source_facts where id = v_draft) is distinct from v_summary then
    raise exception 'FAIL: matching briefing text inserted a second pending_review row';
  end if;

  v_next := public.apply_briefing_field_fact(
    'e06b5000-0000-4000-8000-000000000020',
    'e06b5000-0000-4000-8000-000000000010',
    'parking',
    '{"text":"A lot sits behind the building.","change_summary":"parking: lot behind the building"}'::jsonb,
    'A lot sits behind the building.'
  );
  if v_next is null
    or v_next = v_draft
    or (select status from public.source_facts where id = v_draft) is distinct from 'superseded'
    or (select status from public.source_facts where id = v_next) is distinct from 'pending_review'
    or (select value ->> 'text' from public.source_facts where id = v_draft)
      is distinct from 'Valet parking is available beside the front door.' then
    raise exception 'FAIL: a different briefing draft did not keep the previous row';
  end if;

  if public.apply_briefing_field_fact(
    'e06b5000-0000-4000-8000-000000000020',
    'e06b5000-0000-4000-8000-000000000010',
    'arrival',
    '{"text":"The side gate opens onto the patio."}'::jsonb,
    'The side gate opens onto the patio.'
  ) is not null then
    raise exception 'FAIL: apply wrote a fact over an active row';
  end if;
  if (select status from public.restaurant_briefing_facts where id = 'e06b5000-0000-4000-8000-000000000031')
      is distinct from 'active'
    or not exists (
      select 1 from public.content_exceptions
      where subject_type = 'briefing' and field = 'arrival' and reason = 'conflict' and status = 'open'
    )
    or exists (
      select 1 from public.source_facts
      where subject_type = 'briefing' and field = 'arrival' and status = 'pending_review'
    ) then
    raise exception 'FAIL: active briefing change did not stay an exception';
  end if;

  v_activity := public.apply_activity_field_fact(
    'e06b5000-0000-4000-8000-000000000021',
    'e06b5000-0000-4000-8000-000000000040',
    'summary',
    jsonb_build_object(
      'text', 'A fountain sits on the sample square.',
      'change_summary', 'summary: a fountain sits on the sample square.'
    ),
    'A fountain sits on the sample square.'
  );
  v_activity_again := public.apply_activity_field_fact(
    'e06b5000-0000-4000-8000-000000000021',
    'e06b5000-0000-4000-8000-000000000040',
    'summary',
    '{"text":"A fountain   sits on the sample square.","change_summary":"other"}'::jsonb,
    'A fountain sits on the sample square.'
  );
  if v_activity is null
    or v_activity_again is distinct from v_activity
    or (select count(*) from public.source_facts
        where subject_type = 'activity'
          and subject_id = 'e06b5000-0000-4000-8000-000000000040'
          and field = 'summary'
          and status = 'pending_review') <> 1
    or (select value ->> 'change_summary' from public.source_facts where id = v_activity)
      is distinct from 'summary: a fountain sits on the sample square.'
    or (select status from public.activities where id = 'e06b5000-0000-4000-8000-000000000040')
      is distinct from 'active'
    or (select booking_required from public.activities where id = 'e06b5000-0000-4000-8000-000000000040')
      is distinct from false then
    raise exception 'FAIL: activity summary draft duplicated or rewrote the activity';
  end if;

  if (select count(*) from public.restaurant_offers) <> v_offers
    or (select count(*) from public.entitlement_credits) <> v_credits
    or (select count(*) from public.challenge_items) <> v_items
    or (select count(*) from public.redemptions) <> v_redemptions then
    raise exception 'FAIL: draft summary wrote an offer, credit, challenge, or redemption';
  end if;
end $$;

reset role;
rollback;
select 'PASS: E06-B5 change summaries and pending-draft dedup; fixtures rolled back';
