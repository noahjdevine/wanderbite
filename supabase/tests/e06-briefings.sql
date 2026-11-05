-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E06-A2 briefing facts: constraints, grants, and read of active rows only.
begin;
set local statement_timeout = '15s';

do $$
begin
  if has_table_privilege('anon', 'public.restaurant_briefing_facts', 'INSERT')
    or has_table_privilege('anon', 'public.restaurant_briefing_facts', 'UPDATE')
    or has_table_privilege('anon', 'public.restaurant_briefing_facts', 'DELETE')
    or has_table_privilege('authenticated', 'public.restaurant_briefing_facts', 'INSERT')
    or has_table_privilege('authenticated', 'public.restaurant_briefing_facts', 'UPDATE')
    or has_table_privilege('authenticated', 'public.restaurant_briefing_facts', 'DELETE')
    or not has_table_privilege('anon', 'public.restaurant_briefing_facts', 'SELECT')
    or not has_table_privilege('authenticated', 'public.restaurant_briefing_facts', 'SELECT')
    or not has_table_privilege('service_role', 'public.restaurant_briefing_facts', 'SELECT')
    or not has_table_privilege('service_role', 'public.restaurant_briefing_facts', 'INSERT')
    or not has_table_privilege('service_role', 'public.restaurant_briefing_facts', 'UPDATE')
    or not has_table_privilege('service_role', 'public.restaurant_briefing_facts', 'DELETE') then
    raise exception 'FAIL: restaurant_briefing_facts grants';
  end if;
end $$;

insert into public.restaurants (id, name, status) values
  ('e06a2000-0000-4000-8000-000000000010', 'E06 Briefing Grill', 'active');

do $$
begin
  begin
    insert into public.restaurant_briefing_facts (
      restaurant_id, field, body, source_url, last_verified_at
    ) values (
      'e06a2000-0000-4000-8000-000000000010',
      'offer',
      'Not a briefing field.',
      'https://example.com/e06-bad-field',
      now()
    );
    raise exception 'FAIL: field outside the allowed list was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.restaurant_briefing_facts (
      restaurant_id, field, body, source_url, last_verified_at
    ) values (
      'e06a2000-0000-4000-8000-000000000010',
      'parking',
      'Street parking is noted on the sample page.',
      'http://example.com/e06-http',
      now()
    );
    raise exception 'FAIL: non-https source_url was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.restaurant_briefing_facts (
      restaurant_id, field, body, source_url, last_verified_at
    ) values (
      'e06a2000-0000-4000-8000-000000000010',
      'parking',
      '   ',
      'https://example.com/e06-blank',
      now()
    );
    raise exception 'FAIL: blank fact text was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.restaurant_briefing_facts (
      restaurant_id, field, body, source_url, last_verified_at
    ) values (
      'e06a2000-0000-4000-8000-000000000010',
      'arrival',
      repeat('a', 401),
      'https://example.com/e06-long',
      now()
    );
    raise exception 'FAIL: fact text over 400 characters was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.restaurant_briefing_facts (
      restaurant_id, field, body, source_url, last_verified_at, status
    ) values (
      'e06a2000-0000-4000-8000-000000000010',
      'duration',
      'About an hour.',
      'https://example.com/e06-status',
      now(),
      'expired'
    );
    raise exception 'FAIL: status outside active/paused was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.restaurant_briefing_facts (
      restaurant_id, field, body, source_url, last_verified_at
    ) values (
      'e06a2000-0000-4000-8000-000000000099',
      'parking',
      'No such restaurant.',
      'https://example.com/e06-missing-restaurant',
      now()
    );
    raise exception 'FAIL: fact without a restaurant was accepted';
  exception when foreign_key_violation then null; end;
end $$;

insert into public.restaurant_briefing_facts (
  id, restaurant_id, field, body, source_url, last_verified_at, status, is_sample, version
) values
  (
    'e06a2000-0000-4000-8000-000000000001',
    'e06a2000-0000-4000-8000-000000000010',
    'parking',
    'Sample note: the lot is behind the building.',
    'https://example.com/e06-parking',
    '2026-11-05T05:30:00Z',
    'active',
    true,
    1
  ),
  (
    'e06a2000-0000-4000-8000-000000000002',
    'e06a2000-0000-4000-8000-000000000010',
    'accessibility',
    'Sample note: a paused ramp claim that must stay hidden.',
    'https://example.com/e06-paused',
    '2026-11-05T05:30:00Z',
    'paused',
    true,
    1
  );

do $$
begin
  begin
    insert into public.restaurant_briefing_facts (
      restaurant_id, field, body, source_url, last_verified_at, status
    ) values (
      'e06a2000-0000-4000-8000-000000000010',
      'parking',
      'A second parking fact.',
      'https://example.com/e06-duplicate',
      now(),
      'paused'
    );
    raise exception 'FAIL: a second fact for the same restaurant and field was accepted';
  exception when unique_violation then null; end;
end $$;

set local role anon;
do $$
begin
  if (select count(*) from public.restaurant_briefing_facts) <> 1 then
    raise exception 'FAIL: anon read is not limited to active facts';
  end if;
  if not exists (
    select 1 from public.restaurant_briefing_facts
    where id = 'e06a2000-0000-4000-8000-000000000001'
  ) then
    raise exception 'FAIL: anon cannot read an active fact';
  end if;
  if exists (
    select 1 from public.restaurant_briefing_facts
    where id = 'e06a2000-0000-4000-8000-000000000002'
  ) then
    raise exception 'FAIL: anon can read a paused fact';
  end if;
  begin
    insert into public.restaurant_briefing_facts (
      restaurant_id, field, body, source_url, last_verified_at
    ) values (
      'e06a2000-0000-4000-8000-000000000010',
      'arrival',
      'Anon write',
      'https://example.com/e06-anon',
      now()
    );
    raise exception 'FAIL: anon inserted a fact';
  exception when insufficient_privilege then null; end;
  begin
    update public.restaurant_briefing_facts
    set body = 'Anon edit'
    where id = 'e06a2000-0000-4000-8000-000000000001';
    raise exception 'FAIL: anon updated a fact';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.restaurant_briefing_facts
    where id = 'e06a2000-0000-4000-8000-000000000001';
    raise exception 'FAIL: anon deleted a fact';
  exception when insufficient_privilege then null; end;
end $$;

set local role authenticated;
do $$
begin
  if (select count(*) from public.restaurant_briefing_facts) <> 1 then
    raise exception 'FAIL: member read is not limited to active facts';
  end if;
  if exists (
    select 1 from public.restaurant_briefing_facts
    where id = 'e06a2000-0000-4000-8000-000000000002'
  ) then
    raise exception 'FAIL: member can read a paused fact';
  end if;
  begin
    insert into public.restaurant_briefing_facts (
      restaurant_id, field, body, source_url, last_verified_at
    ) values (
      'e06a2000-0000-4000-8000-000000000010',
      'attire',
      'Member write',
      'https://example.com/e06-member',
      now()
    );
    raise exception 'FAIL: authenticated inserted a fact';
  exception when insufficient_privilege then null; end;
  begin
    update public.restaurant_briefing_facts
    set body = 'Member edit'
    where id = 'e06a2000-0000-4000-8000-000000000001';
    raise exception 'FAIL: authenticated updated a fact';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.restaurant_briefing_facts
    where id = 'e06a2000-0000-4000-8000-000000000001';
    raise exception 'FAIL: authenticated deleted a fact';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role service_role;
insert into public.restaurant_briefing_facts (
  restaurant_id, field, body, source_url, last_verified_at, status, is_sample
) values (
  'e06a2000-0000-4000-8000-000000000010',
  'arrival',
  'Service sample arrival note.',
  'https://example.com/e06-service',
  now(),
  'paused',
  false
);
update public.restaurant_briefing_facts
set body = 'Service sample arrival note, revised.'
where field = 'arrival'
  and restaurant_id = 'e06a2000-0000-4000-8000-000000000010';
delete from public.restaurant_briefing_facts
where field = 'arrival'
  and restaurant_id = 'e06a2000-0000-4000-8000-000000000010';
reset role;

do $$
begin
  if (select body from public.restaurant_briefing_facts where id = 'e06a2000-0000-4000-8000-000000000001')
    is distinct from 'Sample note: the lot is behind the building.' then
    raise exception 'FAIL: a client role changed a fact';
  end if;
  if (select count(*) from public.restaurant_briefing_facts where field = 'arrival') <> 0 then
    raise exception 'FAIL: service_role delete did not remove its row';
  end if;
  if (select status from public.restaurant_briefing_facts where id = 'e06a2000-0000-4000-8000-000000000002')
    is distinct from 'paused' then
    raise exception 'FAIL: paused fact changed status';
  end if;
end $$;

rollback;
select 'PASS: E06 briefing constraints, grants, and active-only reads; fixtures rolled back';
