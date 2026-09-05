-- Invoked only inside test:db's disposable container; all fixture writes roll back.
begin;
set local statement_timeout = '15s';

do $$
declare table_name text;
begin
  foreach table_name in array array['badges', 'user_badges', 'cron_runs', 'admin_audit_log'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || table_name)::regclass) then
      raise exception 'FAIL: % RLS disabled', table_name;
    end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='cron_runs') then
    raise exception 'FAIL: cron_runs client policy exists'; end if;
  if (select count(*) from public.badges) <> 4 or exists (
    select 1 from (values ('first_bite', '🍴'), ('hat_trick', '✨'),
      ('wanderer', '🧭'), ('high_five', '✋')) expected(id, icon)
    left join public.badges b on b.id=expected.id
    where b.icon is distinct from expected.icon
  ) then raise exception 'FAIL: badge glyph seeds do not match the text renderer'; end if;
  if not exists (select 1 from storage.buckets where id='restaurant-photos'
      and public and file_size_limit=5242880
      and allowed_mime_types=array['image/jpeg','image/png','image/webp']) then
    raise exception 'FAIL: photo bucket configuration'; end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.restaurants'::regclass
      and tgname='set_restaurants_updated_at_trigger' and tgenabled='O') then
    raise exception 'FAIL: restaurant update trigger'; end if;
end $$;

-- Required slugs reject omitted and explicit NULL values. Duplicate URLs still fail.
insert into public.markets (name,slug) values ('G1 test market','g1-test-market');
do $$ begin
  begin
    insert into public.markets (name) values ('Missing slug');
    raise exception 'FAIL: omitted slug accepted';
  exception when not_null_violation then null; end;
  begin
    insert into public.markets (name,slug) values ('Null slug',null);
    raise exception 'FAIL: null slug accepted';
  exception when not_null_violation then null; end;
  begin
    insert into public.markets (name,slug) values ('Duplicate slug','g1-test-market');
    raise exception 'FAIL: duplicate slug accepted';
  exception when unique_violation then null; end;
  begin
    update public.markets set slug=null where slug='g1-test-market';
    raise exception 'FAIL: null slug update accepted';
  exception when not_null_violation then null; end;
end $$;

-- Migration 025 actually maintains timestamps, rather than merely naming a trigger.
insert into public.restaurants (id,name,updated_at)
  values ('20000000-0000-4000-8000-000000000001','G1 trigger test','2000-01-01');
update public.restaurants set name='G1 trigger changed'
  where id='20000000-0000-4000-8000-000000000001';
do $$ begin
  if (select updated_at from public.restaurants where id='20000000-0000-4000-8000-000000000001')
      is distinct from now() then raise exception 'FAIL: timestamp not updated'; end if;
end $$;
rollback;
select 'PASS: RLS catalog, badge glyphs, bucket, required/unique slugs, update trigger; fixtures rolled back';
