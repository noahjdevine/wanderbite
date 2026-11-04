-- Run only through the guarded local harness. All fixture rows are rolled back.
begin;
set local statement_timeout = '15s';

insert into auth.users (id) values
  ('e0500000-0000-4000-8000-000000000001'),
  ('e0500000-0000-4000-8000-000000000002');
insert into public.user_profiles (id) values
  ('e0500000-0000-4000-8000-000000000001'),
  ('e0500000-0000-4000-8000-000000000002');
insert into public.restaurants (id, name, status) values
  ('e0500000-0000-4000-8000-000000000010', 'E05 Constraint Grill', 'active');

do $$
declare
  ingredients jsonb := '[{"name":"Demo beans","quantity":"1","unit":"cup"}]'::jsonb;
  steps jsonb := '[{"order":1,"text":"Stir the demo beans."}]'::jsonb;
  substitutions jsonb := '[{"instead_of":"Demo beans","use":"Demo lentils"}]'::jsonb;
begin
  begin
    insert into public.recipes (
      slug, title, recipe_type, servings, est_minutes, ingredients, steps,
      substitutions, rights_basis, visibility
    ) values (
      'e05-approved-missing-source', 'Missing source', 'restaurant_approved',
      2, 20, ingredients, steps, substitutions, 'restaurant_permission', 'draft'
    );
    raise exception 'FAIL: restaurant_approved without source_url or restaurant_id was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.recipes (
      slug, title, recipe_type, restaurant_id, servings, est_minutes, ingredients, steps,
      substitutions, rights_basis, visibility
    ) values (
      'e05-approved-missing-url', 'Missing url', 'restaurant_approved',
      'e0500000-0000-4000-8000-000000000010',
      2, 20, ingredients, steps, substitutions, 'restaurant_permission', 'draft'
    );
    raise exception 'FAIL: restaurant_approved without source_url was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.recipes (
      slug, title, recipe_type, servings, est_minutes, ingredients, steps,
      substitutions, source_url, visibility
    ) values (
      'e05-sourced-missing-rights', 'Missing rights', 'sourced_published',
      2, 20, ingredients, steps, substitutions, 'https://example.com/e05-source', 'draft'
    );
    raise exception 'FAIL: sourced_published without rights_basis was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.recipes (
      slug, title, recipe_type, restaurant_id, servings, est_minutes, ingredients, steps,
      substitutions, rights_basis, visibility
    ) values (
      'e05-inspired-claims-restaurant', 'Claims the restaurant', 'inspired_by',
      'e0500000-0000-4000-8000-000000000010',
      2, 20, ingredients, steps, substitutions, 'restaurant_permission', 'published'
    );
    raise exception 'FAIL: inspired_by with a non-original rights basis was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.recipes (
      slug, title, recipe_type, servings, est_minutes, ingredients, steps,
      substitutions, rights_basis, visibility
    ) values (
      'e05-inspired-unordered', 'Unordered', 'inspired_by',
      2, 20, ingredients, '[{"order":2,"text":"Skip the first step."}]'::jsonb,
      '[]'::jsonb, 'original', 'published'
    );
    raise exception 'FAIL: unordered steps were accepted';
  exception when check_violation then null; end;
end $$;

insert into public.recipes (
  id, slug, title, recipe_type, restaurant_id, servings, est_minutes,
  ingredients, steps, substitutions, dietary_tags, source_url, source_name,
  rights_basis, visibility, checked_at, version, is_demo
) values
  (
    'e0500000-0000-4000-8000-000000000021',
    'e05-demo-inspired',
    'Demo skillet beans',
    'inspired_by',
    'e0500000-0000-4000-8000-000000000010',
    2, 25,
    '[{"name":"Demo beans","quantity":"1","unit":"cup"}]'::jsonb,
    '[{"order":1,"text":"Stir the demo beans."}]'::jsonb,
    '[{"instead_of":"Demo beans","use":"Demo lentils"}]'::jsonb,
    array['beans'],
    null,
    'Wanderbite demo collection',
    'original',
    'published',
    '2026-01-15T18:00:00Z',
    3,
    true
  ),
  (
    'e0500000-0000-4000-8000-000000000022',
    'e05-draft',
    'Draft demo',
    'inspired_by',
    'e0500000-0000-4000-8000-000000000010',
    2, 25,
    '[{"name":"Demo beans","quantity":"1","unit":"cup"}]'::jsonb,
    '[{"order":1,"text":"Stir the demo beans."}]'::jsonb,
    '[]'::jsonb,
    '{}',
    null,
    null,
    'original',
    'draft',
    null,
    1,
    true
  ),
  (
    'e0500000-0000-4000-8000-000000000023',
    'e05-hidden',
    'Hidden demo',
    'inspired_by',
    'e0500000-0000-4000-8000-000000000010',
    2, 25,
    '[{"name":"Demo beans","quantity":"1","unit":"cup"}]'::jsonb,
    '[{"order":1,"text":"Stir the demo beans."}]'::jsonb,
    '[]'::jsonb,
    '{}',
    null,
    null,
    'original',
    'hidden',
    null,
    1,
    true
  ),
  (
    'e0500000-0000-4000-8000-000000000024',
    'e05-approved',
    'Synthetic approved row',
    'restaurant_approved',
    'e0500000-0000-4000-8000-000000000010',
    4, 40,
    '[{"name":"Demo stock","quantity":"2","unit":"cup"}]'::jsonb,
    '[{"order":1,"text":"Warm the demo stock."}]'::jsonb,
    '[]'::jsonb,
    '{}',
    'https://example.com/e05-restaurant-permission',
    'Synthetic source',
    'restaurant_permission',
    'published',
    '2026-01-15T18:00:00Z',
    1,
    false
  );

do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.recipes'::regclass) then
    raise exception 'FAIL: recipes RLS disabled';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.saved_recipes'::regclass) then
    raise exception 'FAIL: saved_recipes RLS disabled';
  end if;
  if has_table_privilege('anon', 'public.recipes', 'INSERT')
    or has_table_privilege('anon', 'public.recipes', 'UPDATE')
    or has_table_privilege('anon', 'public.recipes', 'DELETE')
    or has_table_privilege('authenticated', 'public.recipes', 'INSERT')
    or has_table_privilege('authenticated', 'public.recipes', 'UPDATE')
    or has_table_privilege('authenticated', 'public.recipes', 'DELETE')
    or not has_table_privilege('anon', 'public.recipes', 'SELECT')
    or not has_table_privilege('authenticated', 'public.recipes', 'SELECT')
  then
    raise exception 'FAIL: recipes client grants';
  end if;
  if not has_table_privilege('service_role', 'public.recipes', 'SELECT')
    or not has_table_privilege('service_role', 'public.recipes', 'INSERT')
    or not has_table_privilege('service_role', 'public.recipes', 'UPDATE')
    or not has_table_privilege('service_role', 'public.recipes', 'DELETE')
  then
    raise exception 'FAIL: recipes service_role grants';
  end if;
  if has_table_privilege('anon', 'public.saved_recipes', 'SELECT')
    or has_table_privilege('anon', 'public.saved_recipes', 'INSERT')
    or has_table_privilege('authenticated', 'public.saved_recipes', 'UPDATE')
    or has_table_privilege('service_role', 'public.saved_recipes', 'SELECT')
    or not has_table_privilege('authenticated', 'public.saved_recipes', 'SELECT')
    or not has_table_privilege('authenticated', 'public.saved_recipes', 'INSERT')
    or not has_table_privilege('authenticated', 'public.saved_recipes', 'DELETE')
  then
    raise exception 'FAIL: saved_recipes grants';
  end if;
end $$;

insert into public.recipes (
  id, slug, title, recipe_type, restaurant_id, servings, est_minutes, ingredients, steps,
  substitutions, rights_basis, visibility, source_kind, source_url, source_name,
  description, menu_wording, retrieved_at, is_demo
) values (
  'e0500000-0000-4000-8000-000000000025',
  'e05-public-menu-draft',
  'Unpublished menu take',
  'inspired_by',
  'e0500000-0000-4000-8000-000000000010',
  2, 25,
  '[{"name":"Demo beans","quantity":"1","unit":"cup"}]'::jsonb,
  '[{"order":1,"text":"Stir the demo beans."}]'::jsonb,
  '[]'::jsonb,
  'original',
  'draft',
  'public_menu',
  'https://example.com/e05-menu-draft',
  'Public menu',
  'A home skillet of beans with smoked paprika.',
  'paraphrase',
  '2026-01-15T18:00:00Z',
  false
);

set local role anon;
do $$ begin
  if (select count(*) from public.recipes) <> 2 then
    raise exception 'FAIL: anon can see draft or hidden recipes';
  end if;
  if exists (
    select 1 from public.recipes
    where visibility <> 'published'
  ) then
    raise exception 'FAIL: anon published filter';
  end if;
  if exists (
    select 1 from public.recipes
    where id = 'e0500000-0000-4000-8000-000000000025'
  ) then
    raise exception 'FAIL: unpublished public_menu row is visible to anon';
  end if;
  begin
    perform 1 from public.saved_recipes;
    raise exception 'FAIL: anon can read saves';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
create temporary table e05_side_effects (name text primary key, n bigint);
insert into e05_side_effects (name, n)
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
    or to_regclass('public.raffle_entries') is not null then
    raise exception 'FAIL: a drawing table exists; this save test must count it';
  end if;
end $$;
select set_config('request.jwt.claim.sub', 'e0500000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.recipes) <> 2 then
    raise exception 'FAIL: member can see draft or hidden recipes';
  end if;
  if exists (select 1 from public.recipes where id = 'e0500000-0000-4000-8000-000000000022')
    or exists (select 1 from public.recipes where id = 'e0500000-0000-4000-8000-000000000023')
    or exists (select 1 from public.recipes where id = 'e0500000-0000-4000-8000-000000000025') then
    raise exception 'FAIL: draft or hidden recipe is visible';
  end if;
  if exists (
    select 1 from public.recipes
    where source_kind = 'public_menu' and visibility = 'draft'
  ) then
    raise exception 'FAIL: unpublished public_menu row is visible to members';
  end if;

  begin
    insert into public.recipes (
      slug, title, recipe_type, servings, est_minutes, ingredients, steps,
      substitutions, rights_basis, visibility
    ) values (
      'e05-member-write', 'Member write', 'inspired_by', 1, 10,
      '[{"name":"Demo beans","quantity":"1","unit":"cup"}]'::jsonb,
      '[{"order":1,"text":"Stir."}]'::jsonb,
      '[]'::jsonb, 'original', 'published'
    );
    raise exception 'FAIL: member can insert recipes';
  exception when insufficient_privilege then null; end;

  insert into public.saved_recipes (user_id, recipe_id, recipe_version)
  values (
    'e0500000-0000-4000-8000-000000000001',
    'e0500000-0000-4000-8000-000000000021',
    99
  );
  if (select recipe_version from public.saved_recipes
      where user_id = 'e0500000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'FAIL: save did not store the published recipe version';
  end if;

  begin
    insert into public.saved_recipes (user_id, recipe_id, recipe_version)
    values (
      'e0500000-0000-4000-8000-000000000001',
      'e0500000-0000-4000-8000-000000000022',
      1
    );
    raise exception 'FAIL: draft recipe was saved';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.saved_recipes (user_id, recipe_id, recipe_version)
    values (
      'e0500000-0000-4000-8000-000000000002',
      'e0500000-0000-4000-8000-000000000021',
      1
    );
    raise exception 'FAIL: member saved a recipe for someone else';
  exception when insufficient_privilege then null; end;

  begin
    update public.saved_recipes set recipe_version = 1;
    raise exception 'FAIL: member can update saves';
  exception when insufficient_privilege then null; end;
end $$;

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
  if credits_after <> (select n from e05_side_effects where name = 'credits')
    or verified_after <> (select n from e05_side_effects where name = 'verified')
    or badges_after <> (select n from e05_side_effects where name = 'badges')
    or items_after <> (select n from e05_side_effects where name = 'items')
    or cycles_after <> (select n from e05_side_effects where name = 'cycles')
    or offers_after <> (select n from e05_side_effects where name = 'offers')
    or versions_after <> (select n from e05_side_effects where name = 'versions') then
    raise exception 'FAIL: saving a recipe wrote a credit, verified visit, badge, challenge, or offer';
  end if;
end $$;
select set_config('request.jwt.claim.sub', 'e0500000-0000-4000-8000-000000000002', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.saved_recipes) then
    raise exception 'FAIL: member B can read member A saves';
  end if;
  delete from public.saved_recipes;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.saved_recipes) <> 1 then
    raise exception 'FAIL: member B deleted member A save';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', 'e0500000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.saved_recipes) <> 1 then
    raise exception 'FAIL: member A lost their own save';
  end if;
  delete from public.saved_recipes
  where recipe_id = 'e0500000-0000-4000-8000-000000000021';
  if exists (select 1 from public.saved_recipes) then
    raise exception 'FAIL: member A could not unsave';
  end if;
end $$;

reset role;
insert into public.saved_recipes (user_id, recipe_id, recipe_version)
values (
  'e0500000-0000-4000-8000-000000000001',
  'e0500000-0000-4000-8000-000000000021',
  1
);
delete from public.user_profiles where id = 'e0500000-0000-4000-8000-000000000001';
do $$ begin
  if exists (
    select 1 from public.saved_recipes
    where user_id = 'e0500000-0000-4000-8000-000000000001'
  ) then
    raise exception 'FAIL: account delete left saved recipes';
  end if;
end $$;

set local role service_role;
insert into public.recipes (
  slug, title, recipe_type, servings, est_minutes, ingredients, steps,
  substitutions, rights_basis, visibility, is_demo
) values (
  'e05-service-demo',
  'Service demo row',
  'inspired_by',
  1, 10,
  '[{"name":"Demo oats","quantity":"1","unit":"cup"}]'::jsonb,
  '[{"order":1,"text":"Stir the demo oats."}]'::jsonb,
  '[]'::jsonb,
  'original',
  'draft',
  true
);
reset role;

do $$
declare
  ingredients jsonb := '[{"name":"Demo beans","quantity":"1","unit":"cup"}]'::jsonb;
  steps jsonb := '[{"order":1,"text":"Stir the demo beans."}]'::jsonb;
begin
  begin
    insert into public.recipes (
      slug, title, recipe_type, restaurant_id, servings, est_minutes, ingredients, steps,
      substitutions, rights_basis, visibility, source_kind, description, menu_wording, retrieved_at
    ) values (
      'e05-menu-missing-url', 'Menu take', 'inspired_by',
      'e0500000-0000-4000-8000-000000000010',
      2, 20, ingredients, steps, '[]'::jsonb, 'original', 'draft',
      'public_menu', 'A home skillet of beans with smoked paprika.', 'paraphrase', now()
    );
    raise exception 'FAIL: public_menu without source_url was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.recipes (
      slug, title, recipe_type, restaurant_id, servings, est_minutes, ingredients, steps,
      substitutions, rights_basis, visibility, source_kind, source_url, description, menu_wording
    ) values (
      'e05-menu-missing-retrieved', 'Menu take', 'inspired_by',
      'e0500000-0000-4000-8000-000000000010',
      2, 20, ingredients, steps, '[]'::jsonb, 'original', 'draft',
      'public_menu', 'https://example.com/e05-menu', 'A home skillet of beans with smoked paprika.', 'paraphrase'
    );
    raise exception 'FAIL: public_menu without retrieved_at was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.recipes (
      slug, title, recipe_type, restaurant_id, servings, est_minutes, ingredients, steps,
      substitutions, rights_basis, visibility, source_kind, source_url, description,
      menu_wording, retrieved_at
    ) values (
      'e05-menu-verbatim', 'Menu take', 'inspired_by',
      'e0500000-0000-4000-8000-000000000010',
      2, 20, ingredients, steps, '[]'::jsonb, 'original', 'draft',
      'public_menu', 'https://example.com/e05-menu', 'Copied menu sentence.',
      'verbatim', now()
    );
    raise exception 'FAIL: verbatim menu wording was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.recipes (
      slug, title, recipe_type, restaurant_id, servings, est_minutes, ingredients, steps,
      substitutions, source_url, rights_basis, visibility, source_kind, description,
      menu_wording, retrieved_at
    ) values (
      'e05-menu-approved', 'Menu take', 'restaurant_approved',
      'e0500000-0000-4000-8000-000000000010',
      2, 20, ingredients, steps, '[]'::jsonb,
      'https://example.com/e05-menu', 'restaurant_permission', 'draft',
      'public_menu', 'A home skillet of beans with smoked paprika.', 'paraphrase', now()
    );
    raise exception 'FAIL: public_menu restaurant_approved row was accepted';
  exception when check_violation then null; end;
end $$;

insert into public.recipes (
  slug, title, recipe_type, restaurant_id, servings, est_minutes, ingredients, steps,
  substitutions, rights_basis, visibility, source_kind, source_url, source_name,
  description, menu_wording, retrieved_at, is_demo
) values (
  'e05-public-menu',
  'Demo menu skillet',
  'inspired_by',
  'e0500000-0000-4000-8000-000000000010',
  2, 25,
  '[{"name":"Demo beans","quantity":"1","unit":"cup"}]'::jsonb,
  '[{"order":1,"text":"Stir the demo beans."}]'::jsonb,
  '[]'::jsonb,
  'original',
  'published',
  'public_menu',
  'https://example.com/e05-menu',
  'Example menu',
  'A home skillet of beans with smoked paprika.',
  'paraphrase',
  '2026-01-15T18:00:00Z',
  false
);

do $$ begin
  if (select recipe_type from public.recipes where slug = 'e05-public-menu') <> 'inspired_by'
    or (select source_kind from public.recipes where slug = 'e05-public-menu') <> 'public_menu'
    or (select menu_wording from public.recipes where slug = 'e05-public-menu') <> 'paraphrase'
    or (select rights_basis from public.recipes where slug = 'e05-public-menu') <> 'original' then
    raise exception 'FAIL: public_menu row was not stored as an inspired-by paraphrase';
  end if;
end $$;

rollback;
select 'PASS: E05 recipe constraints, published read, owner saves, and no side-effect writes; fixtures rolled back';
