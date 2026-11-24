-- E06 follow-up: abbreviation-aware sentence count and one-transaction note approve.
-- Applied to hosted. Forward-only. Does not edit 20261124040154.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Same count as activityNoteSentenceCount. Periods inside the listed
-- abbreviations and between digits are not sentence boundaries.
create or replace function public.activity_note_sentence_count(p_body text)
returns integer
language sql
immutable
set search_path to pg_catalog
as $$
  select case
    when p_body is null or btrim(p_body) = '' then 0
    when btrim(p_body) !~ '[.!?]$' then 0
    else (
      select count(*)::integer
      from regexp_split_to_table(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    btrim(p_body),
                    '(^|[^A-Za-z])a\.m\.',
                    '\1am',
                    'gi'
                  ),
                  '(^|[^A-Za-z])p\.m\.',
                  '\1pm',
                  'gi'
                ),
                '(^|[^A-Za-z])e\.g\.',
                '\1eg',
                'gi'
              ),
              '(^|[^A-Za-z])i\.e\.',
              '\1ie',
              'gi'
            ),
            '(^|[^A-Za-z])(Mrs|Mr|Ms|Blvd|Ave|etc|Jr|Dr|St|Mt|Rd|Ln|Sr|vs)\.',
            '\1\2',
            'gi'
          ),
          '([0-9])\.([0-9])',
          '\1\2',
          'g'
        ),
        '[.!?]+'
      ) as sentence
      where btrim(sentence) <> ''
    )
  end;
$$;

comment on function public.activity_note_sentence_count(text) is
  'Sentence count after ignoring Dr/St/Mt/Ave/Blvd/Jr/Mr/Mrs/Ms/Rd/Ln/Sr/vs/a.m./p.m./e.g./i.e./etc periods and decimals such as 3.5. Matches the TypeScript counter.';

revoke all on function public.activity_note_sentence_count(text) from public, anon, authenticated;
grant execute on function public.activity_note_sentence_count(text) to service_role;

-- Locks the draft, pauses every approved note for that restaurant, then
-- approves the draft. A stale version or a non-draft raises and leaves both
-- rows unchanged. service_role only.
create or replace function public.approve_restaurant_activity_note(
  p_note_id uuid,
  p_admin_id uuid,
  p_now timestamptz,
  p_expected_version integer
) returns uuid
language plpgsql
security definer
set search_path to pg_catalog, public
as $$
declare
  v_id uuid;
  v_restaurant_id uuid;
  v_status text;
  v_version integer;
  v_updated integer;
begin
  if p_note_id is null or p_admin_id is null or p_now is null or p_expected_version is null then
    raise exception 'activity note is not a current draft' using errcode = '22023';
  end if;

  select note.id, note.restaurant_id, note.status, note.version
  into v_id, v_restaurant_id, v_status, v_version
  from public.restaurant_activity_notes as note
  where note.id = p_note_id
  for update;

  if v_id is null then
    raise exception 'activity note not found' using errcode = 'P0002';
  end if;

  if v_status is distinct from 'draft' or v_version is distinct from p_expected_version then
    raise exception 'activity note is not a current draft' using errcode = '22023';
  end if;

  perform 1
  from public.restaurant_activity_notes as note
  where note.restaurant_id = v_restaurant_id
    and note.status = 'approved'
  order by note.id
  for update;

  update public.restaurant_activity_notes as note
  set status = 'paused',
      version = note.version + 1,
      reviewed_at = p_now,
      reviewed_by = p_admin_id
  where note.restaurant_id = v_restaurant_id
    and note.status = 'approved';

  update public.restaurant_activity_notes as note
  set status = 'approved',
      version = note.version + 1,
      reviewed_at = p_now,
      reviewed_by = p_admin_id
  where note.id = p_note_id
    and note.status = 'draft'
    and note.version = p_expected_version;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'activity note is not a current draft' using errcode = '22023';
  end if;

  return p_note_id;
end;
$$;

comment on function public.approve_restaurant_activity_note(uuid, uuid, timestamptz, integer) is
  'Approves one draft and pauses any approved note for the same restaurant in one transaction. Fails when the row is not a draft or the version does not match. service_role only.';

revoke all on function public.approve_restaurant_activity_note(uuid, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.approve_restaurant_activity_note(uuid, uuid, timestamptz, integer) to service_role;
