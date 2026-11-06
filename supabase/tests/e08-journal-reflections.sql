-- Run only through the guarded local harness. All fixture rows are rolled back.
-- E08-A2: owner-only journal_reflections. Not applied to hosted.
begin;
set local statement_timeout = '15s';

do $$
declare
  member uuid := 'e08a0000-0000-4000-8000-000000000001';
  other_member uuid := 'e08a0000-0000-4000-8000-000000000002';
  grill uuid := 'e08a0000-0000-4000-8000-000000000011';
  redemption_a uuid := 'e08a0000-0000-4000-8000-000000000021';
  redemption_b uuid := 'e08a0000-0000-4000-8000-000000000022';
  redemption_c uuid := 'e08a0000-0000-4000-8000-000000000023';
  note_a uuid := 'e08a0000-0000-4000-8000-000000000031';
  note_b uuid := 'e08a0000-0000-4000-8000-000000000032';
  note_c uuid := 'e08a0000-0000-4000-8000-000000000033';
  reflection_a uuid := 'e08a0000-0000-4000-8000-000000000041';
  reflection_b uuid := 'e08a0000-0000-4000-8000-000000000042';
  scope_src text;
  scope_config text[];
  err text;
  bite_cols text;
  past_stamp timestamptz := '2020-01-01 00:00:00+00';
  touched timestamptz;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.journal_reflections'::regclass) then
    raise exception 'FAIL: journal reflection RLS disabled';
  end if;
  if (select relforcerowsecurity from pg_class where oid = 'public.journal_reflections'::regclass) then
    raise exception 'FAIL: journal reflection FORCE RLS is on';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'journal_reflections'
  ) then
    raise exception 'FAIL: journal reflection policy exists';
  end if;
  if exists (
    select 1 from pg_policies
    where coalesce(qual, '') || ' ' || coalesce(with_check, '') ilike '%journal_reflections%'
  ) then
    raise exception 'FAIL: a policy references journal_reflections';
  end if;
  if exists (
    select 1 from pg_views
    where schemaname = 'public' and definition ilike '%journal_reflections%'
  ) or exists (
    select 1 from pg_matviews
    where schemaname = 'public' and definition ilike '%journal_reflections%'
  ) then
    raise exception 'FAIL: a view exposes journal_reflections';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'journal_reflections'
      and column_name in ('restaurant_id', 'rating', 'sentiment')
  ) then
    raise exception 'FAIL: extra journal reflection column';
  end if;

  select string_agg(column_name, ',' order by column_name)
    into bite_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'bite_notes';
  if bite_cols is distinct from 'created_at,id,is_public,note,rating,redemption_id,restaurant_id,updated_at,user_id' then
    raise exception 'FAIL: bite_notes columns changed: %', bite_cols;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'journal_reflections_favorite_bite_len'
      and pg_get_constraintdef(oid) ilike '%char_length(favorite_bite) <= 120%'
  ) or not exists (
    select 1 from pg_constraint
    where conname = 'journal_reflections_atmosphere_len'
      and pg_get_constraintdef(oid) ilike '%char_length(atmosphere) <= 280%'
  ) or not exists (
    select 1 from pg_constraint
    where conname = 'journal_reflections_companion_label_len'
      and pg_get_constraintdef(oid) ilike '%char_length(companion_label) <= 40%'
  ) or not exists (
    select 1 from pg_constraint
    where conname = 'journal_reflections_draft_len'
      and pg_get_constraintdef(oid) ilike '%char_length(unpublished_review_draft) <= 1500%'
  ) or not exists (
    select 1 from pg_constraint
    where conname = 'journal_reflections_return_interest_check'
      and pg_get_constraintdef(oid) ilike '%yes%'
      and pg_get_constraintdef(oid) ilike '%maybe%'
      and pg_get_constraintdef(oid) ilike '%no%'
  ) or not exists (
    select 1 from pg_constraint
    where conname = 'journal_reflections_redemption_id_key'
      and contype = 'u'
  ) then
    raise exception 'FAIL: journal reflection checks';
  end if;

  select p.prosrc, p.proconfig
    into scope_src, scope_config
  from pg_proc p
  where p.oid = 'public.journal_reflections_scope()'::regprocedure;
  if not (select prosecdef from pg_proc where oid = 'public.journal_reflections_scope()'::regprocedure)
     or scope_config is distinct from array['search_path=pg_catalog, public']
     or position('favorite_bite' in scope_src) > 0
     or position('atmosphere' in scope_src) > 0
     or position('companion_label' in scope_src) > 0
     or position('unpublished_review_draft' in scope_src) > 0
     or position('return_interest' in scope_src) > 0 then
    raise exception 'FAIL: journal reflection scope shape';
  end if;

  if has_table_privilege('anon', 'public.journal_reflections', 'SELECT')
     or has_table_privilege('anon', 'public.journal_reflections', 'INSERT')
     or has_table_privilege('anon', 'public.journal_reflections', 'UPDATE')
     or has_table_privilege('anon', 'public.journal_reflections', 'DELETE')
     or has_table_privilege('authenticated', 'public.journal_reflections', 'SELECT')
     or has_table_privilege('authenticated', 'public.journal_reflections', 'INSERT')
     or has_table_privilege('authenticated', 'public.journal_reflections', 'UPDATE')
     or has_table_privilege('authenticated', 'public.journal_reflections', 'DELETE')
     or not has_table_privilege('service_role', 'public.journal_reflections', 'SELECT')
     or not has_table_privilege('service_role', 'public.journal_reflections', 'INSERT')
     or not has_table_privilege('service_role', 'public.journal_reflections', 'UPDATE')
     or not has_table_privilege('service_role', 'public.journal_reflections', 'DELETE')
     or has_function_privilege('anon', 'public.journal_reflections_scope()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.journal_reflections_scope()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.journal_reflections_scope()', 'EXECUTE')
     or exists (
       select 1 from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'journal_reflections'
         and grantee in ('PUBLIC', 'anon', 'authenticated')
     ) then
    raise exception 'FAIL: journal reflection grants';
  end if;

  insert into auth.users (id) values (member), (other_member);
  insert into public.user_profiles (id, is_admin) values
    (member, false),
    (other_member, false);
  insert into public.restaurants (id, name, status) values
    (grill, 'E08 Journal Grill', 'active');
  insert into public.redemptions (
    id, user_id, restaurant_id, token_hash, status, verified_at, expires_at
  ) values
    (redemption_a, member, grill, 'e08a-a', 'verified', '2026-11-01 15:00:00+00', now() + interval '15 minutes'),
    (redemption_b, member, grill, 'e08a-b', 'verified', '2026-11-01 15:00:00+00', now() + interval '15 minutes'),
    (redemption_c, other_member, grill, 'e08a-c', 'verified', '2026-11-01 15:00:00+00', now() + interval '15 minutes');
  insert into public.bite_notes (
    id, user_id, redemption_id, restaurant_id, note, rating, is_public
  ) values
    (note_a, member, redemption_a, grill, 'public note a', 5, true),
    (note_b, member, redemption_b, grill, 'public note b', 4, false),
    (note_c, other_member, redemption_c, grill, 'other note', 3, false);

  set local role service_role;

  insert into public.journal_reflections (
    id, user_id, redemption_id, bite_note_id,
    favorite_bite, atmosphere, companion_label, unpublished_review_draft, return_interest,
    created_at, updated_at
  ) values (
    reflection_a, member, redemption_a, null,
    'taco', 'warm room', 'Sam', 'draft text', 'yes',
    past_stamp, past_stamp
  );
  if (select bite_note_id from public.journal_reflections where id = reflection_a) is not null
     or (select return_interest from public.journal_reflections where id = reflection_a) is distinct from 'yes'
     or (select favorite_bite from public.journal_reflections where id = reflection_a) is distinct from 'taco' then
    raise exception 'FAIL: owned reflection was not stored';
  end if;

  update public.journal_reflections
  set bite_note_id = note_a
  where id = reflection_a;
  if (select bite_note_id from public.journal_reflections where id = reflection_a) is distinct from note_a then
    raise exception 'FAIL: matching bite note was not linked';
  end if;
  select updated_at into touched from public.journal_reflections where id = reflection_a;
  if touched is distinct from now()
     or (select created_at from public.journal_reflections where id = reflection_a) is distinct from past_stamp then
    raise exception 'FAIL: updated_at was not touched';
  end if;

  update public.journal_reflections
  set favorite_bite = 'line' || chr(10) || 'two'
  where id = reflection_a;
  if (select favorite_bite from public.journal_reflections where id = reflection_a) is distinct from ('line' || chr(10) || 'two') then
    raise exception 'FAIL: newline was rejected by SQL';
  end if;

  begin
    update public.journal_reflections
    set bite_note_id = note_b
    where id = reflection_a;
    raise exception 'FAIL: bite note from another redemption was linked';
  exception
    when check_violation then
      get stacked diagnostics err = message_text;
      if position('line' in err) > 0 and position(chr(10) in err) > 0 then
        raise exception 'FAIL: note mismatch echoed reflection text';
      end if;
  end;

  begin
    update public.journal_reflections
    set bite_note_id = note_c
    where id = reflection_a;
    raise exception 'FAIL: another member bite note was linked';
  exception when check_violation then null; end;

  begin
    update public.journal_reflections
    set bite_note_id = 'e08a0000-0000-4000-8000-000000000099'
    where id = reflection_a;
    raise exception 'FAIL: missing bite note was linked';
  exception when check_violation then null; end;

  update public.journal_reflections
  set bite_note_id = null
  where id = reflection_a;
  if (select bite_note_id from public.journal_reflections where id = reflection_a) is not null then
    raise exception 'FAIL: bite note was not cleared';
  end if;

  begin
    insert into public.journal_reflections (id, user_id, redemption_id, unpublished_review_draft)
    values (reflection_b, member, redemption_a, 'second');
    raise exception 'FAIL: duplicate redemption stored';
  exception when unique_violation then null; end;

  begin
    insert into public.journal_reflections (
      id, user_id, redemption_id, unpublished_review_draft
    ) values (
      reflection_b, other_member, redemption_a, 'SECRET_DRAFT_E08'
    );
    raise exception 'FAIL: mismatched owner stored';
  exception
    when check_violation then
      get stacked diagnostics err = message_text;
      if position('SECRET_DRAFT_E08' in err) > 0 then
        raise exception 'FAIL: owner mismatch echoed reflection text';
      end if;
  end;

  begin
    insert into public.journal_reflections (id, user_id, redemption_id, favorite_bite)
    values ('e08a0000-0000-4000-8000-000000000043', member, redemption_b, repeat('a', 121));
    raise exception 'FAIL: favorite_bite over 120 stored';
  exception when check_violation then null; end;

  begin
    insert into public.journal_reflections (id, user_id, redemption_id, atmosphere)
    values ('e08a0000-0000-4000-8000-000000000044', member, redemption_b, repeat('b', 281));
    raise exception 'FAIL: atmosphere over 280 stored';
  exception when check_violation then null; end;

  begin
    insert into public.journal_reflections (id, user_id, redemption_id, companion_label)
    values ('e08a0000-0000-4000-8000-000000000045', member, redemption_b, repeat('c', 41));
    raise exception 'FAIL: companion_label over 40 stored';
  exception when check_violation then null; end;

  begin
    insert into public.journal_reflections (id, user_id, redemption_id, unpublished_review_draft)
    values ('e08a0000-0000-4000-8000-000000000046', member, redemption_b, repeat('d', 1501));
    raise exception 'FAIL: draft over 1500 stored';
  exception when check_violation then null; end;

  begin
    insert into public.journal_reflections (id, user_id, redemption_id, return_interest)
    values ('e08a0000-0000-4000-8000-000000000047', member, redemption_b, 'Yes');
    raise exception 'FAIL: invalid return_interest stored';
  exception when check_violation then null; end;

  insert into public.journal_reflections (
    id, user_id, redemption_id, bite_note_id,
    favorite_bite, atmosphere, companion_label, unpublished_review_draft, return_interest
  ) values (
    reflection_b, member, redemption_b, note_b,
    repeat('a', 120), repeat('b', 280), repeat('c', 40), repeat('d', 1500), 'maybe'
  );
  if (select char_length(favorite_bite) from public.journal_reflections where id = reflection_b) <> 120
     or (select char_length(atmosphere) from public.journal_reflections where id = reflection_b) <> 280
     or (select char_length(companion_label) from public.journal_reflections where id = reflection_b) <> 40
     or (select char_length(unpublished_review_draft) from public.journal_reflections where id = reflection_b) <> 1500
     or (select return_interest from public.journal_reflections where id = reflection_b) is distinct from 'maybe'
     or (select bite_note_id from public.journal_reflections where id = reflection_b) is distinct from note_b then
    raise exception 'FAIL: cap-length reflection was not stored';
  end if;

  delete from public.journal_reflections where id = reflection_b;
  if exists (select 1 from public.journal_reflections where id = reflection_b) then
    raise exception 'FAIL: service_role delete did not remove the row';
  end if;

  reset role;
  set local role anon;
  begin
    insert into public.journal_reflections (user_id, redemption_id, favorite_bite)
    values (member, redemption_a, 'nope');
    raise exception 'FAIL: anon insert';
  exception when insufficient_privilege then null; end;
  begin
    if exists (select 1 from public.journal_reflections) then
      raise exception 'FAIL: anon select';
    end if;
  exception when insufficient_privilege then null; end;

  reset role;
  set local role authenticated;
  begin
    insert into public.journal_reflections (user_id, redemption_id, favorite_bite)
    values (member, redemption_a, 'nope');
    raise exception 'FAIL: authenticated insert';
  exception when insufficient_privilege then null; end;
  begin
    if exists (select 1 from public.journal_reflections) then
      raise exception 'FAIL: authenticated select';
    end if;
  exception when insufficient_privilege then null; end;
end $$;

rollback;
