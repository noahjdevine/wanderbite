-- Run only through the guarded local harness. All fixture rows are rolled back.
-- The sentence cases are loaded first from supabase/tests/fixtures/activity-note-sentence-counts.json.
begin;
set local statement_timeout = '15s';

insert into public.restaurants (id, name, status) values
  ('e06d0000-0000-4000-8000-000000000010', 'E06 Approve Grill', 'active'),
  ('e06d0000-0000-4000-8000-000000000011', 'E06 Stale Grill', 'active'),
  ('e06d0000-0000-4000-8000-000000000012', 'E06 Fresh Grill', 'active');

insert into public.activities (
  id, name, category, source_url, lat, lon, cost_category,
  last_verified_at, status, is_sample
) values
  (
    'e06d0000-0000-4000-8000-000000000001',
    'Sample Square Walk',
    'walk',
    'https://example.com/sample-square-walk',
    33.1972, -96.6156, 'free',
    timestamptz '2026-11-24 18:00:00+00', 'active', false
  ),
  (
    'e06d0000-0000-4000-8000-000000000002',
    'Stale Square Walk',
    'walk',
    'https://example.com/stale-square-walk',
    33.1972, -96.6156, 'free',
    timestamptz '2026-11-24 18:00:00+00' - make_interval(secs => 2678400),
    'active', false
  ),
  (
    'e06d0000-0000-4000-8000-000000000003',
    'Fresh Square Walk',
    'walk',
    'https://example.com/fresh-square-walk',
    33.1972, -96.6156, 'free',
    timestamptz '2026-11-24 18:00:00+00' - make_interval(secs => 86400),
    'active', false
  );

insert into auth.users (id) values ('e06d0000-0000-4000-8000-0000000000aa');
insert into public.user_profiles (id, is_admin, role) values
  ('e06d0000-0000-4000-8000-0000000000aa', true, 'admin');

do $$
declare
  sample record;
  actual integer;
  acceptance text := 'After dinner, wander over to St. Peter''s Pub. It''s 3.5 miles away and Dr. Pepper fans will love it.';
  one text;
  five text;
begin
  if (select count(*) from activity_note_sentence_cases) < 8 then
    raise exception 'FAIL: sentence fixture was not loaded';
  end if;
  for sample in select body, expected from activity_note_sentence_cases loop
    actual := public.activity_note_sentence_count(sample.body);
    if actual is distinct from sample.expected then
      raise exception 'FAIL: sentence count % expected % for %', actual, sample.expected, left(sample.body, 80);
    end if;
  end loop;
  if public.activity_note_sentence_count(acceptance) <> 2 then
    raise exception 'FAIL: St. Peter / 3.5 / Dr. Pepper note did not count as 2';
  end if;

  select body into one
  from activity_note_sentence_cases
  where expected = 1 and char_length(body) between 40 and 600
  limit 1;
  select body into five
  from activity_note_sentence_cases
  where expected = 5 and char_length(body) between 40 and 600
  limit 1;
  if one is null or five is null then
    raise exception 'FAIL: fixture is missing a 1-sentence or 5-sentence body in the length window';
  end if;

  begin
    insert into public.restaurant_activity_notes (
      restaurant_id, body, activity_ids, model, prompt_version, source_hash
    ) values (
      'e06d0000-0000-4000-8000-000000000010',
      one,
      array['e06d0000-0000-4000-8000-000000000001']::uuid[],
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
      'e06d0000-0000-4000-8000-000000000010',
      five,
      array['e06d0000-0000-4000-8000-000000000001']::uuid[],
      'claude-haiku-4-5-20251001',
      'e06.activity_note.v1',
      repeat('b', 64)
    );
    raise exception 'FAIL: a five-sentence note was accepted';
  exception when check_violation then null; end;
end $$;

insert into public.restaurant_activity_notes (
  id, restaurant_id, body, status, activity_ids, model, prompt_version, source_hash, version
)
select
  'e06d0000-0000-4000-8000-0000000000c1',
  'e06d0000-0000-4000-8000-000000000010',
  body,
  'draft',
  array['e06d0000-0000-4000-8000-000000000001']::uuid[],
  'claude-haiku-4-5-20251001',
  'e06.activity_note.v1',
  repeat('c', 64),
  1
from activity_note_sentence_cases
where body = 'After dinner, wander over to St. Peter''s Pub. It''s 3.5 miles away and Dr. Pepper fans will love it.';

do $$
begin
  if (select count(*) from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000c1') <> 1 then
    raise exception 'FAIL: the 2-sentence abbreviation note did not pass the check';
  end if;
  if has_function_privilege('anon', 'public.approve_restaurant_activity_note(uuid, uuid, timestamptz, integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.approve_restaurant_activity_note(uuid, uuid, timestamptz, integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.approve_restaurant_activity_note(uuid, uuid, timestamptz, integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.activity_note_sentence_count(text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.activity_note_sentence_count(text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.activity_note_sentence_count(text)', 'EXECUTE') then
    raise exception 'FAIL: activity note function grants';
  end if;
end $$;

insert into public.restaurant_activity_notes (
  id, restaurant_id, body, status, activity_ids, model, prompt_version, source_hash, version
) values (
  'e06d0000-0000-4000-8000-0000000000a1',
  'e06d0000-0000-4000-8000-000000000010',
  'After dinner you can walk over to the square and let the night slow down. Then catch a short set while the meal settles.',
  'approved',
  array['e06d0000-0000-4000-8000-000000000001']::uuid[],
  'claude-haiku-4-5-20251001',
  'e06.activity_note.v1',
  repeat('d', 64),
  1
);

do $$
declare
  approved_status text;
  draft_status text;
  approved_version integer;
  draft_version integer;
begin
  begin
    perform public.approve_restaurant_activity_note(
      'e06d0000-0000-4000-8000-0000000000c1',
      'e06d0000-0000-4000-8000-0000000000aa',
      timestamptz '2026-11-24 18:00:00+00',
      4
    );
    raise exception 'FAIL: a stale version was approved';
  exception when invalid_parameter_value then null; end;

  select status, version into approved_status, approved_version
  from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000a1';
  select status, version into draft_status, draft_version
  from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000c1';
  if approved_status <> 'approved' or approved_version <> 1
    or draft_status <> 'draft' or draft_version <> 1 then
    raise exception 'FAIL: a stale approve changed a note';
  end if;

  begin
    perform public.approve_restaurant_activity_note(
      'e06d0000-0000-4000-8000-0000000000a1',
      'e06d0000-0000-4000-8000-0000000000aa',
      timestamptz '2026-11-24 18:00:00+00',
      1
    );
    raise exception 'FAIL: a non-draft was approved';
  exception when invalid_parameter_value then null; end;

  select status, version into approved_status, approved_version
  from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000a1';
  if approved_status <> 'approved' or approved_version <> 1 then
    raise exception 'FAIL: approving a non-draft changed the current note';
  end if;
end $$;

create function pg_temp.fail_note_approve()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    raise exception 'forced note approve' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger fail_note_approve
  before update on public.restaurant_activity_notes
  for each row execute function pg_temp.fail_note_approve();

do $$
declare
  approved_status text;
  draft_status text;
begin
  begin
    perform public.approve_restaurant_activity_note(
      'e06d0000-0000-4000-8000-0000000000c1',
      'e06d0000-0000-4000-8000-0000000000aa',
      timestamptz '2026-11-24 18:00:00+00',
      1
    );
    raise exception 'FAIL: forced approve did not fail';
  exception
    when others then
      if sqlerrm not like '%forced note approve%' then
        raise;
      end if;
  end;

  select status into approved_status
  from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000a1';
  select status into draft_status
  from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000c1';
  if approved_status <> 'approved' or draft_status <> 'draft' then
    raise exception 'FAIL: a failed approve left a partial write';
  end if;
end $$;

drop trigger fail_note_approve on public.restaurant_activity_notes;

do $$
declare
  approved_status text;
  draft_status text;
begin
  begin
    perform public.approve_restaurant_activity_note(
      'e06d0000-0000-4000-8000-0000000000c1',
      'e06d0000-0000-4000-8000-0000000000ab',
      timestamptz '2026-11-24 18:00:00+00',
      1
    );
    raise exception 'FAIL: a missing admin approved a note';
  exception when foreign_key_violation then null; end;

  select status into approved_status
  from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000a1';
  select status into draft_status
  from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000c1';
  if approved_status <> 'approved' or draft_status <> 'draft' then
    raise exception 'FAIL: a missing admin left a partial write';
  end if;
end $$;

set local role anon;
do $$
begin
  begin
    perform public.approve_restaurant_activity_note(
      'e06d0000-0000-4000-8000-0000000000c1',
      'e06d0000-0000-4000-8000-0000000000aa',
      timestamptz '2026-11-24 18:00:00+00',
      1
    );
    raise exception 'FAIL: anon approved a note';
  exception when insufficient_privilege then null; end;
end $$;

set local role authenticated;
do $$
begin
  begin
    perform public.approve_restaurant_activity_note(
      'e06d0000-0000-4000-8000-0000000000c1',
      'e06d0000-0000-4000-8000-0000000000aa',
      timestamptz '2026-11-24 18:00:00+00',
      1
    );
    raise exception 'FAIL: authenticated approved a note';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role service_role;

do $$
declare
  approved_id uuid;
begin
  approved_id := public.approve_restaurant_activity_note(
    'e06d0000-0000-4000-8000-0000000000c1',
    'e06d0000-0000-4000-8000-0000000000aa',
    timestamptz '2026-11-24 18:00:00+00',
    1
  );
  if approved_id <> 'e06d0000-0000-4000-8000-0000000000c1' then
    raise exception 'FAIL: approve did not return the draft id';
  end if;
  if (select count(*) from public.restaurant_activity_notes
      where restaurant_id = 'e06d0000-0000-4000-8000-000000000010' and status = 'approved') <> 1 then
    raise exception 'FAIL: approve did not leave one approved note';
  end if;
  if (select status from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000a1') <> 'paused'
    or (select version from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000a1') <> 2
    or (select reviewed_by from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000a1')
      <> 'e06d0000-0000-4000-8000-0000000000aa'
    or (select reviewed_at from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000a1')
      <> timestamptz '2026-11-24 18:00:00+00' then
    raise exception 'FAIL: the previous approved note was not retired';
  end if;
  if (select status from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000c1') <> 'approved'
    or (select version from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000c1') <> 2
    or (select reviewed_by from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000c1')
      <> 'e06d0000-0000-4000-8000-0000000000aa' then
    raise exception 'FAIL: the draft was not approved';
  end if;
end $$;

reset role;

insert into public.restaurant_activity_notes (
  id, restaurant_id, body, status, activity_ids, model, prompt_version, source_hash
) values
  (
    'e06d0000-0000-4000-8000-0000000000b1',
    'e06d0000-0000-4000-8000-000000000011',
    'After dinner you can walk over to the square and let the night slow down. Then catch a short set while the meal settles.',
    'approved',
    array['e06d0000-0000-4000-8000-000000000002']::uuid[],
    'claude-haiku-4-5-20251001',
    'e06.activity_note.v1',
    repeat('e', 64)
  ),
  (
    'e06d0000-0000-4000-8000-0000000000b2',
    'e06d0000-0000-4000-8000-000000000012',
    'After dinner you can walk over to the square and let the night slow down. Then catch a short set while the meal settles.',
    'approved',
    array['e06d0000-0000-4000-8000-000000000003']::uuid[],
    'claude-haiku-4-5-20251001',
    'e06.activity_note.v1',
    repeat('f', 64)
  );

do $$
declare
  paused_count integer;
begin
  paused_count := public.pause_stale_activity_notes(timestamptz '2026-11-24 18:00:00+00');
  if paused_count <> 1 then
    raise exception 'FAIL: a 31-day-old note paused % rows', paused_count;
  end if;
  if (select status from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000b1') <> 'paused' then
    raise exception 'FAIL: the 31-day-old note stayed approved';
  end if;
  if (select status from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000b2') <> 'approved' then
    raise exception 'FAIL: a one-day-old note was paused';
  end if;
  if (select status from public.restaurant_activity_notes where id = 'e06d0000-0000-4000-8000-0000000000c1') <> 'approved' then
    raise exception 'FAIL: a freshly approved note was paused';
  end if;
end $$;

rollback;
select 'PASS: E06 sentence counts, atomic approve, and 31-day pause; fixtures rolled back';
