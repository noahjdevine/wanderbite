-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E06-B1: activity subject_type, grants, activity fact helpers, dated expiry.
begin;
set local statement_timeout = '15s';

do $$
begin
  if has_table_privilege('anon', 'public.source_facts', 'INSERT')
    or has_table_privilege('anon', 'public.source_facts', 'UPDATE')
    or has_table_privilege('anon', 'public.source_facts', 'DELETE')
    or has_table_privilege('authenticated', 'public.source_facts', 'INSERT')
    or has_table_privilege('authenticated', 'public.source_facts', 'UPDATE')
    or has_table_privilege('authenticated', 'public.source_facts', 'DELETE')
    or has_table_privilege('anon', 'public.content_exceptions', 'INSERT')
    or has_table_privilege('anon', 'public.content_exceptions', 'UPDATE')
    or has_table_privilege('anon', 'public.content_exceptions', 'DELETE')
    or has_table_privilege('authenticated', 'public.content_exceptions', 'INSERT')
    or has_table_privilege('authenticated', 'public.content_exceptions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.content_exceptions', 'DELETE')
    or has_table_privilege('anon', 'public.activities', 'INSERT')
    or has_table_privilege('anon', 'public.activities', 'UPDATE')
    or has_table_privilege('anon', 'public.activities', 'DELETE')
    or has_table_privilege('authenticated', 'public.activities', 'INSERT')
    or has_table_privilege('authenticated', 'public.activities', 'UPDATE')
    or has_table_privilege('authenticated', 'public.activities', 'DELETE') then
    raise exception 'FAIL: anon or authenticated can write pipeline or activity rows';
  end if;
  if has_function_privilege('anon', 'public.apply_activity_field_fact(uuid, uuid, text, jsonb, text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.rollback_activity_field_fact(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.expire_dated_activities(date)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.expire_dated_activities(date)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.apply_activity_field_fact(uuid, uuid, text, jsonb, text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.rollback_activity_field_fact(uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.expire_dated_activities(date)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.apply_recipe_description_fact(uuid, uuid, jsonb, text, timestamptz, uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.rollback_recipe_to_previous(uuid)', 'EXECUTE') then
    raise exception 'FAIL: activity helper grants';
  end if;
end $$;

insert into public.content_sources (id, kind, url, status, notes)
values (
  'e06b1000-0000-4000-8000-000000000010',
  'venue_page',
  'https://example.com/e06b1-venue',
  'active',
  'Local activity pipeline fixture.'
);

do $$
begin
  begin
    insert into public.source_facts (
      source_id, subject_type, field, value, evidence_excerpt, version, status
    ) values (
      'e06b1000-0000-4000-8000-000000000010',
      'partnership',
      'summary',
      '{"text":"no"}'::jsonb,
      'no',
      1,
      'pending_review'
    );
    raise exception 'FAIL: subject_type partnership was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.content_exceptions (source_id, subject_type, reason)
    values (
      'e06b1000-0000-4000-8000-000000000010',
      'booking',
      'sensitive'
    );
    raise exception 'FAIL: exception subject_type booking was accepted';
  exception when check_violation then null; end;
end $$;

insert into public.source_facts (
  id, source_id, subject_type, field, value, evidence_excerpt, version, status
) values (
  'e06b1000-0000-4000-8000-000000000031',
  'e06b1000-0000-4000-8000-000000000010',
  'activity',
  'summary',
  '{"text":"A sample walk."}'::jsonb,
  'A sample walk.',
  1,
  'pending_review'
);

insert into public.content_exceptions (
  source_id, subject_type, field, reason, evidence_excerpt
) values (
  'e06b1000-0000-4000-8000-000000000010',
  'activity',
  'price',
  'conflict',
  'Price changed on the sample page.'
);

insert into public.source_facts (
  source_id, subject_type, field, value, evidence_excerpt, version, status
) values (
  'e06b1000-0000-4000-8000-000000000010',
  'recipe',
  'description',
  '{"text":"recipe still allowed"}'::jsonb,
  'recipe still allowed',
  1,
  'current'
);

insert into public.activities (
  id, name, category, source_url, content_source_id, lat, lon, zip,
  cost_category, hours_note, valid_until, status, booking_required, is_sample
) values
  (
    'e06b1000-0000-4000-8000-000000000001',
    'Sample Keep Name',
    'walk',
    'https://example.com/e06b1-venue',
    'e06b1000-0000-4000-8000-000000000010',
    33.2, -96.6, '75069',
    'free',
    'Afternoons on the sample listing',
    '2026-11-04',
    'active',
    false,
    true
  ),
  (
    'e06b1000-0000-4000-8000-000000000002',
    'Sample Still Current',
    'arts',
    'https://example.com/e06b1-current',
    null,
    33.2, -96.6, '75069',
    'free',
    null,
    '2026-11-05',
    'active',
    false,
    true
  ),
  (
    'e06b1000-0000-4000-8000-000000000003',
    'Sample Undated',
    'museum',
    'https://example.com/e06b1-undated',
    null,
    33.2, -96.6, '75069',
    'free',
    null,
    null,
    'active',
    true,
    true
  );

set local role anon;
do $$
begin
  begin
    insert into public.source_facts (
      source_id, subject_type, field, value, evidence_excerpt, version, status
    ) values (
      'e06b1000-0000-4000-8000-000000000010',
      'activity',
      'summary',
      '{"text":"anon"}'::jsonb,
      'anon',
      9,
      'pending_review'
    );
    raise exception 'FAIL: anon inserted a source fact';
  exception when insufficient_privilege then null; end;
  begin
    update public.source_facts set status = 'rejected' where id = 'e06b1000-0000-4000-8000-000000000031';
    raise exception 'FAIL: anon updated a source fact';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.source_facts where id = 'e06b1000-0000-4000-8000-000000000031';
    raise exception 'FAIL: anon deleted a source fact';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.content_exceptions (source_id, subject_type, reason)
    values ('e06b1000-0000-4000-8000-000000000010', 'activity', 'sensitive');
    raise exception 'FAIL: anon inserted a content exception';
  exception when insufficient_privilege then null; end;
  begin
    update public.content_exceptions set status = 'rejected', resolved_at = now();
    raise exception 'FAIL: anon updated a content exception';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.content_exceptions;
    raise exception 'FAIL: anon deleted a content exception';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.activities (name, category, cost_category, zip)
    values ('Anon activity', 'walk', 'free', '75069');
    raise exception 'FAIL: anon inserted an activity';
  exception when insufficient_privilege then null; end;
  begin
    update public.activities set status = 'expired' where id = 'e06b1000-0000-4000-8000-000000000001';
    raise exception 'FAIL: anon updated an activity';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.activities where id = 'e06b1000-0000-4000-8000-000000000001';
    raise exception 'FAIL: anon deleted an activity';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
do $$
begin
  begin
    insert into public.source_facts (
      source_id, subject_type, field, value, evidence_excerpt, version, status
    ) values (
      'e06b1000-0000-4000-8000-000000000010',
      'activity',
      'summary',
      '{"text":"member"}'::jsonb,
      'member',
      8,
      'pending_review'
    );
    raise exception 'FAIL: authenticated inserted a source fact';
  exception when insufficient_privilege then null; end;
  begin
    update public.content_exceptions set reason = 'sensitive';
    raise exception 'FAIL: authenticated updated a content exception';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.activities where id = 'e06b1000-0000-4000-8000-000000000001';
    raise exception 'FAIL: authenticated deleted an activity';
  exception when insufficient_privilege then null; end;
  begin
    perform public.expire_dated_activities('2026-11-05'::date);
    raise exception 'FAIL: authenticated expired activities';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
select public.apply_activity_field_fact(
  'e06b1000-0000-4000-8000-000000000010',
  'e06b1000-0000-4000-8000-000000000001',
  'summary',
  '{"text":"A fountain sits on the sample square."}'::jsonb,
  'A fountain sits on the sample square.'
);
do $$
begin
  begin
    perform public.apply_activity_field_fact(
      'e06b1000-0000-4000-8000-000000000010',
      'e06b1000-0000-4000-8000-000000000099',
      'summary',
      '{"text":"missing"}'::jsonb,
      'missing'
    );
    raise exception 'FAIL: missing activity was created';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.apply_activity_field_fact(
      'e06b1000-0000-4000-8000-000000000010',
      'e06b1000-0000-4000-8000-000000000001',
      'summary',
      '{"text":"This includes a discount."}'::jsonb,
      'This includes a discount.'
    );
    raise exception 'FAIL: discount wording was stored';
  exception when sqlstate '22023' then null; end;
end $$;

select public.expire_dated_activities('2026-11-05'::date);
reset role;

do $$
declare
  v_name text;
  v_status text;
  v_booking boolean;
  v_hours text;
  v_count integer;
begin
  select name, status, booking_required, hours_note
  into v_name, v_status, v_booking, v_hours
  from public.activities
  where id = 'e06b1000-0000-4000-8000-000000000001';
  if v_name is distinct from 'Sample Keep Name'
    or v_booking is distinct from false
    or v_hours is distinct from 'Afternoons on the sample listing'
    or v_status is distinct from 'expired' then
    raise exception 'FAIL: activity row was rewritten or not expired';
  end if;
  if (select status from public.activities where id = 'e06b1000-0000-4000-8000-000000000002')
    is distinct from 'active' then
    raise exception 'FAIL: an activity valid today was expired';
  end if;
  if (select status from public.activities where id = 'e06b1000-0000-4000-8000-000000000003')
    is distinct from 'active' then
    raise exception 'FAIL: an undated activity was expired';
  end if;
  select count(*) into v_count from public.activities
  where id in (
    'e06b1000-0000-4000-8000-000000000001',
    'e06b1000-0000-4000-8000-000000000002',
    'e06b1000-0000-4000-8000-000000000003'
  );
  if v_count <> 3 then
    raise exception 'FAIL: expiry deleted an activity';
  end if;
  if not exists (
    select 1 from public.source_facts
    where subject_type = 'activity'
      and subject_id = 'e06b1000-0000-4000-8000-000000000001'
      and field = 'summary'
      and status = 'pending_review'
      and value ->> 'text' = 'A fountain sits on the sample square.'
  ) then
    raise exception 'FAIL: activity summary draft was not stored';
  end if;
  if exists (
    select 1 from public.activities where id = 'e06b1000-0000-4000-8000-000000000099'
  ) then
    raise exception 'FAIL: a partnership activity was inserted';
  end if;
end $$;

delete from public.content_sources where id = 'e06b1000-0000-4000-8000-000000000010';

do $$
begin
  if (select content_source_id from public.activities where id = 'e06b1000-0000-4000-8000-000000000001')
    is not null then
    raise exception 'FAIL: content_source_id was not cleared when the source was deleted';
  end if;
  if (select count(*) from public.activities where id = 'e06b1000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'FAIL: deleting a source deleted the activity';
  end if;
end $$;

rollback;
select 'PASS: E06-B1 activity subject, grants, draft fact, and dated expiry; fixtures rolled back';
