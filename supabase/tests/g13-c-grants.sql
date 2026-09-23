-- G13-C: client roles cannot read stored photo URL columns. View shape stays, values are null.
begin;
set local statement_timeout = '15s';

do $$
declare
  def text;
begin
  if has_column_privilege('anon', 'public.restaurants', 'image_url', 'SELECT')
    or has_column_privilege('anon', 'public.restaurants', 'google_photo_url', 'SELECT')
    or has_column_privilege('authenticated', 'public.restaurants', 'image_url', 'SELECT')
    or has_column_privilege('authenticated', 'public.restaurants', 'google_photo_url', 'SELECT')
  then
    raise exception 'FAIL: client SELECT remains on image_url or google_photo_url';
  end if;

  if not has_column_privilege('service_role', 'public.restaurants', 'image_url', 'SELECT')
    or not has_column_privilege('service_role', 'public.restaurants', 'google_photo_url', 'SELECT')
    or not has_column_privilege('anon', 'public.restaurants', 'google_place_id', 'SELECT')
    or not has_column_privilege('anon', 'public.restaurants', 'name', 'SELECT')
  then
    raise exception 'FAIL: expected restaurant column privileges missing';
  end if;

  if exists (
    select 1
    from pg_class c
    cross join lateral aclexplode(c.relacl) acl
    where c.oid = 'public.restaurants'::regclass
      and acl.privilege_type = 'SELECT'
      and (
        acl.grantee = 0
        or acl.grantee in ('anon'::regrole, 'authenticated'::regrole)
      )
  ) then
    raise exception 'FAIL: table-level SELECT remains for a client role';
  end if;

  def := pg_get_viewdef('public.restaurants_public'::regclass, true);
  if position('null::text as image_url' in lower(def)) = 0
    or position('null::text as google_photo_url' in lower(def)) = 0
  then
    raise exception 'FAIL: public view does not null photo columns: %', def;
  end if;
end $$;

insert into public.markets (name, slug)
values ('G13C Market', 'g13c-photo-market');

insert into public.restaurant_orgs (name, market_id)
select 'G13C Org', id from public.markets where slug = 'g13c-photo-market';

insert into public.restaurants (
  name, org_id, market_id, status, image_url, google_photo_url, google_place_id
)
select
  'G13C Photo',
  o.id,
  m.id,
  'active',
  'stored-image-sentinel',
  'stored-photo-sentinel',
  'place-sentinel'
from public.restaurant_orgs o
join public.markets m on m.id = o.market_id
where m.slug = 'g13c-photo-market';

set local role anon;

do $$
declare
  img text;
  photo text;
begin
  begin
    perform image_url from public.restaurants limit 1;
    raise exception 'FAIL: anon read restaurants.image_url';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform google_photo_url from public.restaurants limit 1;
    raise exception 'FAIL: anon read restaurants.google_photo_url';
  exception
    when insufficient_privilege then
      null;
  end;

  select image_url, google_photo_url into img, photo
  from public.restaurants_public
  where name = 'G13C Photo';

  if not found then
    raise exception 'FAIL: sentinel missing from restaurants_public';
  end if;
  if img is not null or photo is not null then
    raise exception 'FAIL: view emitted stored photo columns';
  end if;
end $$;

reset role;
set local role service_role;

do $$
declare
  photo text;
begin
  select google_photo_url into photo
  from public.restaurants
  where name = 'G13C Photo';
  if photo is distinct from 'stored-photo-sentinel' then
    raise exception 'FAIL: service_role cannot read stored google_photo_url';
  end if;
end $$;

reset role;
rollback;

select 'PASS: G13-C photo column grants';
