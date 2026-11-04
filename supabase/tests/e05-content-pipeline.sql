-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

do $$ begin
  if (select count(*) from public.content_sources) <> 0
    or (select count(*) from public.source_fetch_attempts) <> 0
    or (select count(*) from public.source_facts) <> 0
    or (select count(*) from public.content_exceptions) <> 0 then
    raise exception 'FAIL: migration seeded content pipeline rows';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.content_sources'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.source_fetch_attempts'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.source_facts'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.content_exceptions'::regclass) then
    raise exception 'FAIL: content pipeline RLS disabled';
  end if;
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'content_sources',
        'source_fetch_attempts',
        'source_facts',
        'content_exceptions'
      )
      and (
        'anon' = any (roles)
        or 'authenticated' = any (roles)
        or 'public' = any (roles)
      )
  ) then
    raise exception 'FAIL: member policy on a content pipeline table';
  end if;
  if has_table_privilege('anon', 'public.content_sources', 'SELECT')
    or has_table_privilege('anon', 'public.content_sources', 'INSERT')
    or has_table_privilege('anon', 'public.content_sources', 'UPDATE')
    or has_table_privilege('anon', 'public.content_sources', 'DELETE')
    or has_table_privilege('authenticated', 'public.content_sources', 'SELECT')
    or has_table_privilege('authenticated', 'public.content_sources', 'INSERT')
    or has_table_privilege('authenticated', 'public.source_fetch_attempts', 'SELECT')
    or has_table_privilege('authenticated', 'public.source_facts', 'SELECT')
    or has_table_privilege('authenticated', 'public.source_facts', 'INSERT')
    or has_table_privilege('authenticated', 'public.content_exceptions', 'SELECT')
    or has_table_privilege('authenticated', 'public.content_exceptions', 'UPDATE')
    or has_table_privilege('anon', 'public.source_facts', 'DELETE') then
    raise exception 'FAIL: member grants on content pipeline tables';
  end if;
  if not has_table_privilege('service_role', 'public.content_sources', 'SELECT')
    or not has_table_privilege('service_role', 'public.content_sources', 'INSERT')
    or not has_table_privilege('service_role', 'public.content_sources', 'UPDATE')
    or not has_table_privilege('service_role', 'public.content_sources', 'DELETE')
    or not has_table_privilege('service_role', 'public.source_fetch_attempts', 'INSERT')
    or not has_table_privilege('service_role', 'public.source_facts', 'UPDATE')
    or not has_table_privilege('service_role', 'public.content_exceptions', 'DELETE') then
    raise exception 'FAIL: service_role grants on content pipeline tables';
  end if;
  if has_function_privilege('anon', 'public.rollback_recipe_to_previous(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.rollback_content_fact(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.resolve_saved_recipe_description(uuid, uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.rollback_recipe_to_previous(uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.rollback_content_fact(uuid)', 'EXECUTE') then
    raise exception 'FAIL: content pipeline function grants';
  end if;
end $$;

do $$ begin
  begin
    insert into public.content_sources (kind, url)
    values ('blog', 'https://example.com/e05b2-blog');
    raise exception 'FAIL: unknown source kind was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.content_sources (kind, url)
    values ('public_menu', 'http://example.com/e05b2-http');
    raise exception 'FAIL: non-https source URL was accepted';
  exception when check_violation then null; end;
end $$;

insert into public.content_sources (id, kind, url, status, notes)
values
  (
    'e05b2000-0000-4000-8000-000000000030',
    'public_menu',
    'https://example.com/e05b2-menu',
    'active',
    'Local pipeline fixture.'
  ),
  (
    'e05b2000-0000-4000-8000-000000000031',
    'venue_page',
    'https://example.com/e05b2-venue',
    'paused',
    'Reserved kind stays inactive.'
  );

do $$ begin
  begin
    insert into public.content_sources (kind, url)
    values ('event_page', 'https://example.com/e05b2-menu');
    raise exception 'FAIL: duplicate source URL was accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.source_fetch_attempts (source_id, outcome)
    values ('e05b2000-0000-4000-8000-000000000030', 'fetched');
    raise exception 'FAIL: unknown attempt outcome was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.source_facts (
      source_id, subject_type, field, value, evidence_excerpt, version, status
    ) values (
      'e05b2000-0000-4000-8000-000000000030',
      'recipe',
      'description',
      '{"text":"x"}'::jsonb,
      repeat('e', 241),
      1,
      'current'
    );
    raise exception 'FAIL: long evidence excerpt was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.content_exceptions (source_id, reason, status, resolved_at)
    values (
      'e05b2000-0000-4000-8000-000000000030',
      'conflict',
      'open',
      now()
    );
    raise exception 'FAIL: open exception with resolved_at was accepted';
  exception when check_violation then null; end;
end $$;

set local role anon;
do $$ begin
  begin
    perform 1 from public.content_sources;
    raise exception 'FAIL: anon can read content_sources';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.source_fetch_attempts;
    raise exception 'FAIL: anon can read source_fetch_attempts';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.source_facts;
    raise exception 'FAIL: anon can read source_facts';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.content_exceptions (source_id, reason)
    values ('e05b2000-0000-4000-8000-000000000030', 'conflict');
    raise exception 'FAIL: anon can write content_exceptions';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
do $$ begin
  begin
    perform 1 from public.content_sources;
    raise exception 'FAIL: member can read content_sources';
  exception when insufficient_privilege then null; end;
  begin
    update public.source_facts set status = 'rejected';
    raise exception 'FAIL: member can update source_facts';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.content_exceptions;
    raise exception 'FAIL: member can delete content_exceptions';
  exception when insufficient_privilege then null; end;
  begin
    perform public.rollback_recipe_to_previous('e05b2000-0000-4000-8000-000000000021');
    raise exception 'FAIL: member can roll back a recipe';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

insert into auth.users (id) values ('e05b2000-0000-4000-8000-000000000001');
insert into public.user_profiles (id) values ('e05b2000-0000-4000-8000-000000000001');
insert into public.restaurants (id, name, status) values
  ('e05b2000-0000-4000-8000-000000000010', 'E05 Pipeline Grill', 'active');

insert into public.recipes (
  id, slug, title, recipe_type, restaurant_id, servings, est_minutes,
  ingredients, steps, substitutions, rights_basis, visibility, source_kind,
  source_url, source_name, description, menu_wording, retrieved_at, version, is_demo
) values (
  'e05b2000-0000-4000-8000-000000000021',
  'e05b2-skillet',
  'Home Skillet Beans',
  'inspired_by',
  'e05b2000-0000-4000-8000-000000000010',
  2, 25,
  '[{"name":"White beans","quantity":"2","unit":"cup"}]'::jsonb,
  '[{"order":1,"text":"Warm the beans with paprika and garlic."}]'::jsonb,
  '[]'::jsonb,
  'original',
  'published',
  'public_menu',
  'https://example.com/e05b2-menu',
  'Public menu',
  'A home pot of beans warmed with paprika and garlic.',
  'paraphrase',
  '2026-01-15T18:00:00Z',
  1,
  false
);

select set_config('request.jwt.claim.sub', 'e05b2000-0000-4000-8000-000000000001', true);
set local role authenticated;
insert into public.saved_recipes (user_id, recipe_id, recipe_version)
values (
  'e05b2000-0000-4000-8000-000000000001',
  'e05b2000-0000-4000-8000-000000000021',
  99
);
reset role;

insert into public.source_facts (
  id, source_id, subject_type, subject_id, field, value, evidence_excerpt, version, status
) values (
  'e05b2000-0000-4000-8000-000000000041',
  'e05b2000-0000-4000-8000-000000000030',
  'recipe',
  'e05b2000-0000-4000-8000-000000000021',
  'description',
  jsonb_build_object(
    'dish', 'Skillet Beans',
    'text', 'A home pot of beans warmed with paprika and garlic.',
    'menu_description', 'White beans simmered with smoked paprika, garlic, and olive oil until the sauce turns glossy.',
    'ingredients', jsonb_build_array('white beans', 'smoked paprika', 'garlic', 'olive oil'),
    'price', '$12'
  ),
  'White beans simmered with smoked paprika, garlic, and olive oil until the sauce turns glossy.',
  1,
  'current'
);

do $$ begin
  if (select recipe_version from public.saved_recipes
      where user_id = 'e05b2000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'FAIL: save did not store the published recipe version';
  end if;
  if public.resolve_saved_recipe_description(
    'e05b2000-0000-4000-8000-000000000001',
    'e05b2000-0000-4000-8000-000000000021'
  ) is distinct from 'A home pot of beans warmed with paprika and garlic.' then
    raise exception 'FAIL: saved version did not resolve the original description';
  end if;
end $$;

update public.source_facts
set status = 'superseded'
where id = 'e05b2000-0000-4000-8000-000000000041';
insert into public.source_facts (
  id, source_id, subject_type, subject_id, field, value, evidence_excerpt, version, status
) values (
  'e05b2000-0000-4000-8000-000000000042',
  'e05b2000-0000-4000-8000-000000000030',
  'recipe',
  'e05b2000-0000-4000-8000-000000000021',
  'description',
  jsonb_build_object(
    'dish', 'Skillet Beans',
    'text', 'A weeknight skillet of beans with a smoky paprika finish.',
    'menu_description', 'White beans finished with a smoky paprika oil and plenty of garlic.',
    'ingredients', jsonb_build_array('white beans', 'smoked paprika', 'garlic', 'olive oil'),
    'price', '$12'
  ),
  'White beans finished with a smoky paprika oil and plenty of garlic.',
  2,
  'current'
);
update public.recipes
set description = 'A weeknight skillet of beans with a smoky paprika finish.',
    version = 2
where id = 'e05b2000-0000-4000-8000-000000000021';

do $$ begin
  if (select version from public.recipes where id = 'e05b2000-0000-4000-8000-000000000021') <> 2 then
    raise exception 'FAIL: recipe version did not bump';
  end if;
  if (select recipe_version from public.saved_recipes
      where user_id = 'e05b2000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'FAIL: source change rewrote the saved recipe version';
  end if;
  if public.resolve_saved_recipe_description(
    'e05b2000-0000-4000-8000-000000000001',
    'e05b2000-0000-4000-8000-000000000021'
  ) is distinct from 'A home pot of beans warmed with paprika and garlic.' then
    raise exception 'FAIL: saved version no longer resolves after the bump';
  end if;
  if (select count(*) from public.source_facts
      where subject_id = 'e05b2000-0000-4000-8000-000000000021') <> 2 then
    raise exception 'FAIL: prior fact version was not kept';
  end if;
end $$;

do $$ begin
  begin
    insert into public.source_facts (
      source_id, subject_type, subject_id, field, value, evidence_excerpt, version, status
    ) values (
      'e05b2000-0000-4000-8000-000000000030',
      'recipe',
      'e05b2000-0000-4000-8000-000000000021',
      'description',
      '{"text":"second current"}'::jsonb,
      'second current',
      3,
      'current'
    );
    raise exception 'FAIL: two current description facts were accepted';
  exception when unique_violation then null; end;
end $$;

select public.rollback_recipe_to_previous('e05b2000-0000-4000-8000-000000000021');

do $$ begin
  if (select version from public.recipes where id = 'e05b2000-0000-4000-8000-000000000021') <> 3 then
    raise exception 'FAIL: recipe rollback did not record a new version';
  end if;
  if (select description from public.recipes where id = 'e05b2000-0000-4000-8000-000000000021')
    is distinct from 'A home pot of beans warmed with paprika and garlic.' then
    raise exception 'FAIL: recipe rollback did not restore the previous description';
  end if;
  if (select recipe_type from public.recipes where id = 'e05b2000-0000-4000-8000-000000000021')
    is distinct from 'inspired_by'
    or (select visibility from public.recipes where id = 'e05b2000-0000-4000-8000-000000000021')
    is distinct from 'published' then
    raise exception 'FAIL: recipe rollback changed type or visibility';
  end if;
  if (select count(*) from public.source_facts
      where subject_id = 'e05b2000-0000-4000-8000-000000000021') <> 3 then
    raise exception 'FAIL: recipe rollback deleted history';
  end if;
  if (select status from public.source_facts where id = 'e05b2000-0000-4000-8000-000000000041')
    is distinct from 'superseded'
    or (select status from public.source_facts where version = 3
        and subject_id = 'e05b2000-0000-4000-8000-000000000021')
    is distinct from 'current' then
    raise exception 'FAIL: recipe rollback did not keep prior rows and a new current fact';
  end if;
  if (select recipe_version from public.saved_recipes
      where user_id = 'e05b2000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'FAIL: recipe rollback rewrote the saved row';
  end if;
  if public.resolve_saved_recipe_description(
    'e05b2000-0000-4000-8000-000000000001',
    'e05b2000-0000-4000-8000-000000000021'
  ) is distinct from 'A home pot of beans warmed with paprika and garlic.' then
    raise exception 'FAIL: saved version did not resolve after rollback';
  end if;
end $$;

select public.rollback_content_fact('e05b2000-0000-4000-8000-000000000042');

do $$ begin
  if (select count(*) from public.source_facts
      where subject_id = 'e05b2000-0000-4000-8000-000000000021') <> 4 then
    raise exception 'FAIL: fact rollback deleted history';
  end if;
  if (select value ->> 'text' from public.source_facts
      where subject_id = 'e05b2000-0000-4000-8000-000000000021'
        and status = 'current')
    is distinct from 'A weeknight skillet of beans with a smoky paprika finish.' then
    raise exception 'FAIL: fact rollback did not restore the previous fact value';
  end if;
  if (select version from public.recipes where id = 'e05b2000-0000-4000-8000-000000000021') <> 3 then
    raise exception 'FAIL: fact rollback rewrote the recipe version';
  end if;
end $$;

create temporary table e05b2_side_effects (name text primary key, n bigint);
insert into e05b2_side_effects (name, n)
select 'credits', count(*) from public.entitlement_credits
union all select 'verified', count(*) from public.redemptions where status = 'verified'
union all select 'badges', count(*) from public.user_badges
union all select 'items', count(*) from public.challenge_items
union all select 'cycles', count(*) from public.challenge_cycles
union all select 'offers', count(*) from public.restaurant_offers
union all select 'versions', count(*) from public.offer_versions;

do $$ begin
  if to_regclass('public.drawing_entries') is not null
    or to_regclass('public.drawings') is not null
    or to_regclass('public.raffle_entries') is not null
    or to_regclass('public.user_xp') is not null
    or to_regclass('public.xp_events') is not null then
    raise exception 'FAIL: a drawing or XP table exists; this pipeline test must count it';
  end if;
end $$;

set local role service_role;
insert into public.source_fetch_attempts (source_id, outcome, http_status, content_hash)
values (
  'e05b2000-0000-4000-8000-000000000030',
  'unchanged',
  200,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
insert into public.content_exceptions (
  source_id, subject_type, subject_id, field, reason, before, after, evidence_excerpt
) values (
  'e05b2000-0000-4000-8000-000000000030',
  'recipe',
  'e05b2000-0000-4000-8000-000000000021',
  'ingredients',
  'conflict',
  '{"items":["beans"]}'::jsonb,
  '{"items":["lentils"]}'::jsonb,
  'Ingredient list contradicts the current fact.'
);
update public.content_sources
set last_attempted_at = '2026-01-15T18:00:00Z',
    last_verified_at = '2026-01-15T18:00:00Z'
where id = 'e05b2000-0000-4000-8000-000000000030';
reset role;

do $$
declare
  credits_after bigint;
  verified_after bigint;
  badges_after bigint;
  items_after bigint;
  cycles_after bigint;
  offers_after bigint;
  versions_after bigint;
begin
  select count(*) into credits_after from public.entitlement_credits;
  select count(*) into verified_after from public.redemptions where status = 'verified';
  select count(*) into badges_after from public.user_badges;
  select count(*) into items_after from public.challenge_items;
  select count(*) into cycles_after from public.challenge_cycles;
  select count(*) into offers_after from public.restaurant_offers;
  select count(*) into versions_after from public.offer_versions;
  if credits_after <> (select n from e05b2_side_effects where name = 'credits')
    or verified_after <> (select n from e05b2_side_effects where name = 'verified')
    or badges_after <> (select n from e05b2_side_effects where name = 'badges')
    or items_after <> (select n from e05b2_side_effects where name = 'items')
    or cycles_after <> (select n from e05b2_side_effects where name = 'cycles')
    or offers_after <> (select n from e05b2_side_effects where name = 'offers')
    or versions_after <> (select n from e05b2_side_effects where name = 'versions') then
    raise exception 'FAIL: content pipeline wrote a credit, offer, challenge, verified visit, or badge';
  end if;
end $$;

rollback;
select 'PASS: E05-B2 content pipeline RLS, constraints, version history, and saved recipe resolution; fixtures rolled back';
