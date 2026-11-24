-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E06 personal notes: wider categories, kids_oriented, note checks, one approved row.
begin;
set local statement_timeout = '15s';

insert into public.restaurants (id, name, status) values
  ('e06c0000-0000-4000-8000-000000000010', 'E06 Note Grill', 'active');

insert into public.activities (
  id, name, category, source_url, lat, lon, cost_category,
  last_verified_at, status, is_sample
) values (
  'e06c0000-0000-4000-8000-000000000001',
  'Sample Square Walk',
  'walk',
  'https://example.com/sample-square-walk',
  33.1972, -96.6156, 'free',
  now(), 'active', false
);

do $$
declare
  category text;
begin
  if (select kids_oriented from public.activities where id = 'e06c0000-0000-4000-8000-000000000001')
    is distinct from false then
    raise exception 'FAIL: kids_oriented did not default to false';
  end if;

  foreach category in array array[
    'museum', 'walk', 'class', 'sports', 'arts',
    'comedy', 'theater', 'live_music', 'games', 'landmark', 'dessert'
  ] loop
    insert into public.activities (name, category, cost_category, zip, is_sample)
    values ('Category ' || category, category, 'free', '75069', true);
  end loop;

  begin
    insert into public.activities (name, category, cost_category, zip)
    values ('Unknown category', 'karaoke', 'free', '75069');
    raise exception 'FAIL: unknown activity category was accepted';
  exception when check_violation then null; end;

  if has_table_privilege('anon', 'public.restaurant_activity_notes', 'SELECT')
    or has_table_privilege('anon', 'public.restaurant_activity_notes', 'INSERT')
    or has_table_privilege('authenticated', 'public.restaurant_activity_notes', 'INSERT')
    or has_table_privilege('authenticated', 'public.restaurant_activity_notes', 'UPDATE')
    or has_table_privilege('authenticated', 'public.restaurant_activity_notes', 'DELETE')
    or not has_table_privilege('authenticated', 'public.restaurant_activity_notes', 'SELECT')
    or not has_table_privilege('service_role', 'public.restaurant_activity_notes', 'INSERT')
    or not has_table_privilege('service_role', 'public.restaurant_activity_notes', 'UPDATE')
    or has_function_privilege('anon', 'public.pause_stale_activity_notes(timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.pause_stale_activity_notes(timestamptz)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.pause_stale_activity_notes(timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: activity note grants';
  end if;
end $$;

do $$
declare
  good text := 'After dinner you can walk over to the square and let the night slow down. Then catch a short set while the meal settles.';
begin
  begin
    insert into public.restaurant_activity_notes (
      restaurant_id, body, activity_ids, model, prompt_version, source_hash
    ) values (
      'e06c0000-0000-4000-8000-000000000010',
      'Too short.',
      array['e06c0000-0000-4000-8000-000000000001']::uuid[],
      'claude-haiku-4-5-20251001',
      'e06.activity_note.v1',
      repeat('a', 64)
    );
    raise exception 'FAIL: a one-sentence note was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.restaurant_activity_notes (
      restaurant_id, body, activity_ids, model, prompt_version, source_hash
    ) values (
      'e06c0000-0000-4000-8000-000000000010',
      'One stop is nearby tonight. Two stops can wait. Three stops are too many. Four stops will not fit. Five stops is the limit here.',
      array['e06c0000-0000-4000-8000-000000000001']::uuid[],
      'claude-haiku-4-5-20251001',
      'e06.activity_note.v1',
      repeat('b', 64)
    );
    raise exception 'FAIL: a five-sentence note was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.restaurant_activity_notes (
      restaurant_id, body, activity_ids, model, prompt_version, source_hash
    ) values (
      'e06c0000-0000-4000-8000-000000000010',
      good || ' It costs $5.',
      array['e06c0000-0000-4000-8000-000000000001']::uuid[],
      'claude-haiku-4-5-20251001',
      'e06.activity_note.v1',
      repeat('c', 64)
    );
    raise exception 'FAIL: a note with a price was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.restaurant_activity_notes (
      restaurant_id, body, activity_ids, model, prompt_version, source_hash
    ) values (
      'e06c0000-0000-4000-8000-000000000010',
      'See https://example.com/hours after dinner and then walk a little more. The second sentence stays on the page.',
      array['e06c0000-0000-4000-8000-000000000001']::uuid[],
      'claude-haiku-4-5-20251001',
      'e06.activity_note.v1',
      repeat('d', 64)
    );
    raise exception 'FAIL: a note with a link was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.restaurant_activity_notes (
      restaurant_id, body, activity_ids, model, prompt_version, source_hash
    ) values (
      'e06c0000-0000-4000-8000-000000000010',
      good,
      array[]::uuid[],
      'claude-haiku-4-5-20251001',
      'e06.activity_note.v1',
      repeat('e', 64)
    );
    raise exception 'FAIL: a note with no activities was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.restaurant_activity_notes (
      restaurant_id, body, activity_ids, model, prompt_version, source_hash
    ) values (
      'e06c0000-0000-4000-8000-000000000010',
      good,
      array[
        'e06c0000-0000-4000-8000-000000000001',
        'e06c0000-0000-4000-8000-000000000001'
      ]::uuid[],
      'claude-haiku-4-5-20251001',
      'e06.activity_note.v1',
      repeat('f', 64)
    );
    raise exception 'FAIL: a repeated activity id was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.restaurant_activity_notes (
      restaurant_id, body, activity_ids, model, prompt_version, source_hash
    ) values (
      'e06c0000-0000-4000-8000-000000000010',
      good,
      array['e06c0000-0000-4000-8000-000000000099']::uuid[],
      'claude-haiku-4-5-20251001',
      'e06.activity_note.v1',
      repeat('0', 64)
    );
    raise exception 'FAIL: an unknown activity id was accepted';
  exception when foreign_key_violation then null; end;
end $$;

insert into public.restaurant_activity_notes (
  id, restaurant_id, body, status, activity_ids, model, prompt_version, source_hash
) values (
  'e06c0000-0000-4000-8000-0000000000a1',
  'e06c0000-0000-4000-8000-000000000010',
  'After dinner you can walk over to the square and let the night slow down. Then catch a short set while the meal settles.',
  'approved',
  array['e06c0000-0000-4000-8000-000000000001']::uuid[],
  'claude-haiku-4-5-20251001',
  'e06.activity_note.v1',
  repeat('1', 64)
);

do $$
begin
  begin
    insert into public.restaurant_activity_notes (
      restaurant_id, body, status, activity_ids, model, prompt_version, source_hash
    ) values (
      'e06c0000-0000-4000-8000-000000000010',
      'After dinner you can walk over to the square and let the night slow down. Then catch a short set while the meal settles.',
      'approved',
      array['e06c0000-0000-4000-8000-000000000001']::uuid[],
      'claude-haiku-4-5-20251001',
      'e06.activity_note.v1',
      repeat('2', 64)
    );
    raise exception 'FAIL: a second approved note was accepted';
  exception when unique_violation then null; end;
end $$;

insert into public.restaurant_activity_notes (
  id, restaurant_id, body, status, activity_ids, model, prompt_version, source_hash
) values (
  'e06c0000-0000-4000-8000-0000000000a2',
  'e06c0000-0000-4000-8000-000000000010',
  'After dinner you can walk over to the square and let the night slow down. Then catch a different short set while the meal settles.',
  'draft',
  array['e06c0000-0000-4000-8000-000000000001']::uuid[],
  'claude-haiku-4-5-20251001',
  'e06.activity_note.v1',
  repeat('3', 64)
);

update public.restaurant_activity_notes
set status = 'paused'
where id = 'e06c0000-0000-4000-8000-0000000000a1';

update public.restaurant_activity_notes
set status = 'approved'
where id = 'e06c0000-0000-4000-8000-0000000000a2';

do $$
declare
  paused_count integer;
begin
  if (select count(*) from public.restaurant_activity_notes where restaurant_id = 'e06c0000-0000-4000-8000-000000000010' and status = 'approved') <> 1 then
    raise exception 'FAIL: approving a second draft did not leave one approved note';
  end if;
  if (select status from public.restaurant_activity_notes where id = 'e06c0000-0000-4000-8000-0000000000a1') <> 'paused' then
    raise exception 'FAIL: the earlier approved note was not paused';
  end if;

  paused_count := public.pause_stale_activity_notes(now());
  if paused_count <> 0 then
    raise exception 'FAIL: a current note was paused';
  end if;

  update public.activities
  set status = 'paused'
  where id = 'e06c0000-0000-4000-8000-000000000001';
  paused_count := public.pause_stale_activity_notes(now());
  if paused_count <> 1
    or (select status from public.restaurant_activity_notes where id = 'e06c0000-0000-4000-8000-0000000000a2') <> 'paused' then
    raise exception 'FAIL: a note citing a paused activity stayed approved';
  end if;

  update public.activities
  set status = 'active', last_verified_at = now()
  where id = 'e06c0000-0000-4000-8000-000000000001';
  paused_count := public.pause_stale_activity_notes(now());
  if paused_count <> 0
    or (select status from public.restaurant_activity_notes where id = 'e06c0000-0000-4000-8000-0000000000a2') <> 'paused' then
    raise exception 'FAIL: a paused note was approved again';
  end if;
end $$;

set local role anon;
do $$
begin
  begin
    perform 1 from public.restaurant_activity_notes;
    raise exception 'FAIL: anon read an activity note';
  exception when insufficient_privilege then null; end;
end $$;

set local role authenticated;
do $$
begin
  if (select count(*) from public.restaurant_activity_notes) <> 0 then
    raise exception 'FAIL: a member read a draft, rejected, paused, or sample note';
  end if;
  begin
    insert into public.restaurant_activity_notes (
      restaurant_id, body, activity_ids, model, prompt_version, source_hash
    ) values (
      'e06c0000-0000-4000-8000-000000000010',
      'After dinner you can walk over to the square and let the night slow down. Then catch a short set while the meal settles.',
      array['e06c0000-0000-4000-8000-000000000001']::uuid[],
      'claude-haiku-4-5-20251001',
      'e06.activity_note.v1',
      repeat('4', 64)
    );
    raise exception 'FAIL: authenticated inserted an activity note';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
update public.restaurant_activity_notes
set status = 'approved', is_sample = false
where id = 'e06c0000-0000-4000-8000-0000000000a2';

set local role authenticated;
do $$
begin
  if (select count(*) from public.restaurant_activity_notes where id = 'e06c0000-0000-4000-8000-0000000000a2') <> 1 then
    raise exception 'FAIL: a member cannot read an approved note';
  end if;
  if exists (
    select 1 from public.restaurant_activity_notes
    where id = 'e06c0000-0000-4000-8000-0000000000a1'
  ) then
    raise exception 'FAIL: a member read a paused note';
  end if;
end $$;

reset role;
rollback;
select 'PASS: E06 activity notes, category check, and one approved note; fixtures rolled back';
