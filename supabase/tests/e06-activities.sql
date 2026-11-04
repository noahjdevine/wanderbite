-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E06-A1 activities: constraints, grants, and read of active non-expired rows.
begin;
set local statement_timeout = '15s';

do $$
begin
  if has_table_privilege('anon', 'public.activities', 'INSERT')
    or has_table_privilege('anon', 'public.activities', 'UPDATE')
    or has_table_privilege('anon', 'public.activities', 'DELETE')
    or has_table_privilege('authenticated', 'public.activities', 'INSERT')
    or has_table_privilege('authenticated', 'public.activities', 'UPDATE')
    or has_table_privilege('authenticated', 'public.activities', 'DELETE')
    or not has_table_privilege('anon', 'public.activities', 'SELECT')
    or not has_table_privilege('authenticated', 'public.activities', 'SELECT')
    or not has_table_privilege('service_role', 'public.activities', 'SELECT')
    or not has_table_privilege('service_role', 'public.activities', 'INSERT')
    or not has_table_privilege('service_role', 'public.activities', 'UPDATE')
    or not has_table_privilege('service_role', 'public.activities', 'DELETE') then
    raise exception 'FAIL: activities grants';
  end if;
end $$;

do $$
begin
  begin
    insert into public.activities (name, category, cost_category, lat, lon)
    values ('Bad category', 'restaurant', 'free', 33.2, -96.6);
    raise exception 'FAIL: category outside the allowed list was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.activities (name, category, cost_category, lat, lon)
    values ('Bad cost', 'museum', 'percent', 33.2, -96.6);
    raise exception 'FAIL: cost category outside the allowed list was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.activities (name, category, cost_category, status, lat, lon)
    values ('Bad status', 'walk', 'free', 'draft', 33.2, -96.6);
    raise exception 'FAIL: status outside active/paused/expired was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.activities (name, category, cost_category)
    values ('No location', 'arts', 'unknown');
    raise exception 'FAIL: activity with neither coordinates nor ZIP was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.activities (name, category, cost_category, lat)
    values ('Half coordinate', 'class', 'free', 33.2);
    raise exception 'FAIL: latitude without longitude was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.activities (name, category, cost_category, zip, source_url)
    values ('Bad url', 'sports', 'free', '75069', 'http://example.com/sample');
    raise exception 'FAIL: non-https source_url was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.activities (
      name, category, cost_category, zip, valid_from, valid_until
    ) values (
      'Backwards dates', 'museum', 'free', '75069', '2026-12-02', '2026-12-01'
    );
    raise exception 'FAIL: valid_from after valid_until was accepted';
  exception when check_violation then null; end;
end $$;

insert into public.activities (
  id, name, category, source_url, lat, lon, zip, typical_duration_minutes,
  cost_category, hours_note, valid_from, valid_until, weather_dependent,
  booking_required, last_verified_at, status, is_sample, version
) values
  (
    'e0600000-0000-4000-8000-000000000001',
    'Sample Square Walk',
    'walk',
    'https://example.com/sample-square-walk',
    33.1972, -96.6156, '75069', 40,
    'free', null, null, null, false, false, now(), 'active', true, 1
  ),
  (
    'e0600000-0000-4000-8000-000000000002',
    'Sample Through Today',
    'museum',
    'https://example.com/sample-through-today',
    null, null, '75069', 60,
    '$', null,
    (timezone('America/Chicago', now()))::date,
    (timezone('America/Chicago', now()))::date,
    false, false, now(), 'active', true, 1
  ),
  (
    'e0600000-0000-4000-8000-000000000003',
    'Sample Ended Yesterday',
    'arts',
    'https://example.com/sample-ended-yesterday',
    33.1972, -96.6156, '75069', 30,
    '$$', null, null,
    (timezone('America/Chicago', now()))::date - 1,
    false, true, now(), 'active', true, 1
  ),
  (
    'e0600000-0000-4000-8000-000000000004',
    'Sample Paused Court',
    'sports',
    'https://example.com/sample-paused-court',
    33.1972, -96.6156, '75069', 50,
    'free', null, null, null, true, false, now(), 'paused', true, 1
  ),
  (
    'e0600000-0000-4000-8000-000000000005',
    'Sample Expired Class',
    'class',
    'https://example.com/sample-expired-class',
    33.1972, -96.6156, '75069', 45,
    'unknown', null, null, null, false, true, now(), 'expired', true, 1
  );

set local role anon;
do $$
begin
  if (select count(*) from public.activities) <> 2 then
    raise exception 'FAIL: anon read is not limited to active non-expired rows';
  end if;
  if exists (
    select 1 from public.activities
    where id in (
      'e0600000-0000-4000-8000-000000000003',
      'e0600000-0000-4000-8000-000000000004',
      'e0600000-0000-4000-8000-000000000005'
    )
  ) then
    raise exception 'FAIL: anon can read paused, expired, or past-dated activities';
  end if;
  begin
    insert into public.activities (name, category, cost_category, zip)
    values ('Anon write', 'walk', 'free', '75069');
    raise exception 'FAIL: anon inserted an activity';
  exception when insufficient_privilege then null; end;
  begin
    update public.activities set name = 'Anon edit' where id = 'e0600000-0000-4000-8000-000000000001';
    raise exception 'FAIL: anon updated an activity';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.activities where id = 'e0600000-0000-4000-8000-000000000001';
    raise exception 'FAIL: anon deleted an activity';
  exception when insufficient_privilege then null; end;
end $$;

set local role authenticated;
do $$
begin
  if (select count(*) from public.activities) <> 2 then
    raise exception 'FAIL: member read is not limited to active non-expired rows';
  end if;
  if not exists (
    select 1 from public.activities where id = 'e0600000-0000-4000-8000-000000000001'
  ) or not exists (
    select 1 from public.activities where id = 'e0600000-0000-4000-8000-000000000002'
  ) then
    raise exception 'FAIL: member cannot read an active current activity';
  end if;
  if exists (
    select 1 from public.activities
    where id in (
      'e0600000-0000-4000-8000-000000000003',
      'e0600000-0000-4000-8000-000000000004',
      'e0600000-0000-4000-8000-000000000005'
    )
  ) then
    raise exception 'FAIL: member can read paused, expired, or past-dated activities';
  end if;
  begin
    insert into public.activities (name, category, cost_category, zip)
    values ('Member write', 'walk', 'free', '75069');
    raise exception 'FAIL: authenticated inserted an activity';
  exception when insufficient_privilege then null; end;
  begin
    update public.activities set name = 'Member edit' where id = 'e0600000-0000-4000-8000-000000000001';
    raise exception 'FAIL: authenticated updated an activity';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.activities where id = 'e0600000-0000-4000-8000-000000000001';
    raise exception 'FAIL: authenticated deleted an activity';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role service_role;
insert into public.activities (name, category, cost_category, zip, is_sample)
values ('Service sample', 'arts', 'free', '75070', true);
update public.activities
set hours_note = 'Check the sample listing'
where name = 'Service sample';
delete from public.activities where name = 'Service sample';
reset role;

do $$
begin
  if (select name from public.activities where id = 'e0600000-0000-4000-8000-000000000001')
    is distinct from 'Sample Square Walk' then
    raise exception 'FAIL: a client role changed an activity name';
  end if;
  if (select count(*) from public.activities where name = 'Service sample') <> 0 then
    raise exception 'FAIL: service_role delete did not remove its row';
  end if;
end $$;

rollback;
select 'PASS: E06 activities constraints, grants, and active non-expired reads; fixtures rolled back';
