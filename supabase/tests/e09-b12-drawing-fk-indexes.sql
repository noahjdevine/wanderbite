-- Run only through the guarded local harness. No fixture rows.
-- E09-B12: the winners composite foreign key has a valid index on
-- (selection_id, campaign_id), creating it again is a no-op, and every
-- other drawing foreign key already has an index that leads with its columns.
begin;
set local statement_timeout = '15s';

create index if not exists drawing_selection_winners_selection_campaign_idx
  on public.drawing_selection_winners (selection_id, campaign_id);

create index if not exists drawing_selection_winners_selection_campaign_idx
  on public.drawing_selection_winners (selection_id, campaign_id);

do $$
declare
  cols text[];
  index_count integer;
  uncovered text;
  fk_count integer;
begin
  select count(*)
    into index_count
  from pg_class ic
  join pg_namespace n on n.oid = ic.relnamespace
  where n.nspname = 'public'
    and ic.relname = 'drawing_selection_winners_selection_campaign_idx';
  if index_count is distinct from 1 then
    raise exception 'FAIL: winners composite covering index count %', index_count;
  end if;

  select array_agg(a.attname order by u.ord)
    into cols
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  join pg_class c on c.oid = i.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  join lateral unnest(i.indkey::smallint[]) with ordinality as u(attnum, ord) on true
  join pg_attribute a
    on a.attrelid = c.oid
   and a.attnum = u.attnum
  where n.nspname = 'public'
    and c.relname = 'drawing_selection_winners'
    and ic.relname = 'drawing_selection_winners_selection_campaign_idx'
    and i.indisvalid
    and i.indisready
    and not i.indisunique
    and i.indpred is null
    and u.attnum > 0;

  if cols is distinct from array['selection_id', 'campaign_id']::text[] then
    raise exception 'FAIL: winners composite covering index columns are %', cols;
  end if;

  select count(*)
    into fk_count
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f'
    and n.nspname = 'public'
    and starts_with(c.relname, 'drawing_');
  if fk_count is distinct from 9 then
    raise exception 'FAIL: drawing foreign key count %', fk_count;
  end if;

  select string_agg(
    fk.child || ' ' || fk.conname || ' (' || array_to_string(fk.cols, ', ') || ')',
    '; ' order by fk.child, fk.conname
  )
    into uncovered
  from (
    select
      c.oid as child_oid,
      c.relname as child,
      con.conname,
      (
        select array_agg(a.attname order by u.ord)
        from unnest(con.conkey) with ordinality as u(attnum, ord)
        join pg_attribute a
          on a.attrelid = c.oid
         and a.attnum = u.attnum
      ) as cols
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.contype = 'f'
      and n.nspname = 'public'
      and starts_with(c.relname, 'drawing_')
  ) fk
  where not exists (
    select 1
    from pg_index i
    where i.indrelid = fk.child_oid
      and i.indisvalid
      and i.indisready
      and (
        select array_agg(a.attname order by u.ord)
        from unnest(i.indkey::smallint[]) with ordinality as u(attnum, ord)
        join pg_attribute a
          on a.attrelid = i.indrelid
         and a.attnum = u.attnum
        where u.attnum > 0
          and u.ord <= cardinality(fk.cols)
      ) = fk.cols
  );

  if uncovered is not null then
    raise exception 'FAIL: drawing foreign key without a leading covering index: %', uncovered;
  end if;
end;
$$;

select
  fk.child || '|' || fk.conname || '|' || array_to_string(fk.cols, ',')
    || '|->' || fk.parent || '|' || covered.index_name
from (
  select
    c.oid as child_oid,
    c.relname as child,
    con.conname,
    con.confrelid::regclass::text as parent,
    (
      select array_agg(a.attname order by u.ord)
      from unnest(con.conkey) with ordinality as u(attnum, ord)
      join pg_attribute a
        on a.attrelid = c.oid
       and a.attnum = u.attnum
    ) as cols
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f'
    and n.nspname = 'public'
    and starts_with(c.relname, 'drawing_')
) fk
cross join lateral (
  select ic.relname as index_name
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  where i.indrelid = fk.child_oid
    and i.indisvalid
    and i.indisready
    and (
      select array_agg(a.attname order by u.ord)
      from unnest(i.indkey::smallint[]) with ordinality as u(attnum, ord)
      join pg_attribute a
        on a.attrelid = i.indrelid
       and a.attnum = u.attnum
      where u.attnum > 0
        and u.ord <= cardinality(fk.cols)
    ) = fk.cols
  order by ic.relname
  limit 1
) covered
order by fk.child, fk.conname;

rollback;
