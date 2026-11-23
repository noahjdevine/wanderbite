-- Run only through the guarded local harness. All fixture rows are rolled back.
-- Site problem reports: service role writes, members and anon cannot read or change rows.
begin;
set local statement_timeout = '15s';

do $$
declare
  member uuid := '5c1e0000-0000-4000-8000-000000000001';
  report_id uuid := '5c1e0000-0000-4000-8000-000000000011';
  cols text;
  visit_cols text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.site_problem_reports'::regclass) then
    raise exception 'FAIL: site problem report RLS disabled';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_problem_reports'
  ) then
    raise exception 'FAIL: site problem report policy exists';
  end if;

  select string_agg(column_name, ',' order by column_name)
    into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'site_problem_reports';
  if cols is distinct from
    'admin_note,contact_email,created_at,id,page_path,reviewed_at,reviewed_by,status,trying_to_do,user_agent,user_id,what_happened'
  then
    raise exception 'FAIL: site problem report columns: %', cols;
  end if;

  select string_agg(column_name, ',' order by column_name)
    into visit_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'visit_problem_cases';
  if visit_cols is distinct from
    'category,challenge_item_id,created_at,explanation,id,member_response,redemption_id,resolved_at,status,updated_at,user_id'
  then
    raise exception 'FAIL: visit problem columns changed: %', visit_cols;
  end if;

  if has_table_privilege('anon', 'public.site_problem_reports', 'SELECT')
     or has_table_privilege('anon', 'public.site_problem_reports', 'INSERT')
     or has_table_privilege('anon', 'public.site_problem_reports', 'UPDATE')
     or has_table_privilege('anon', 'public.site_problem_reports', 'DELETE')
     or has_table_privilege('authenticated', 'public.site_problem_reports', 'SELECT')
     or has_table_privilege('authenticated', 'public.site_problem_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.site_problem_reports', 'UPDATE')
     or has_table_privilege('authenticated', 'public.site_problem_reports', 'DELETE')
     or not has_table_privilege('service_role', 'public.site_problem_reports', 'SELECT')
     or not has_table_privilege('service_role', 'public.site_problem_reports', 'INSERT')
     or not has_table_privilege('service_role', 'public.site_problem_reports', 'UPDATE')
     or not has_table_privilege('service_role', 'public.site_problem_reports', 'DELETE')
  then
    raise exception 'FAIL: site problem report grants';
  end if;

  insert into auth.users (id) values (member);

  begin
    insert into public.site_problem_reports (what_happened) values ('too short');
    raise exception 'FAIL: short report accepted';
  exception when check_violation then null; end;

  begin
    insert into public.site_problem_reports (what_happened, page_path)
    values ('The button did nothing at all', '//evil.com');
    raise exception 'FAIL: protocol-relative page accepted';
  exception when check_violation then null; end;

  begin
    insert into public.site_problem_reports (what_happened, page_path)
    values ('The button did nothing at all', 'https://evil.com/phish');
    raise exception 'FAIL: absolute page accepted';
  exception when check_violation then null; end;

  begin
    insert into public.site_problem_reports (what_happened, page_path)
    values ('The button did nothing at all', 'javascript:alert(1)');
    raise exception 'FAIL: javascript page accepted';
  exception when check_violation then null; end;

  begin
    insert into public.site_problem_reports (what_happened, status)
    values ('The button did nothing at all', 'open');
    raise exception 'FAIL: bad status accepted';
  exception when check_violation then null; end;

  begin
    insert into public.site_problem_reports (what_happened, user_agent)
    values ('The button did nothing at all', repeat('a', 301));
    raise exception 'FAIL: long user agent accepted';
  exception when check_violation then null; end;

  insert into public.site_problem_reports (
    id, user_id, contact_email, page_path, what_happened, trying_to_do, user_agent
  ) values (
    report_id,
    member,
    'guest@example.com',
    '/challenges',
    'The button did nothing at all',
    'Open my challenge',
    repeat('u', 300)
  );

  if (select user_id from public.site_problem_reports where id = report_id) is distinct from member
     or (select status from public.site_problem_reports where id = report_id) is distinct from 'new'
     or (select char_length(user_agent) from public.site_problem_reports where id = report_id) <> 300
     or (select page_path from public.site_problem_reports where id = report_id) is distinct from '/challenges'
  then
    raise exception 'FAIL: report row was not stored';
  end if;

  delete from auth.users where id = member;
  if (select user_id from public.site_problem_reports where id = report_id) is not null then
    raise exception 'FAIL: deleted user did not clear user_id';
  end if;
end $$;

set local role anon;
do $$
begin
  begin
    perform 1 from public.site_problem_reports;
    raise exception 'FAIL: anon select';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.site_problem_reports (what_happened)
    values ('The button did nothing at all');
    raise exception 'FAIL: anon insert';
  exception when insufficient_privilege then null; end;
  begin
    update public.site_problem_reports set status = 'closed';
    raise exception 'FAIL: anon update';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.site_problem_reports;
    raise exception 'FAIL: anon delete';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role authenticated;
do $$
begin
  begin
    perform 1 from public.site_problem_reports;
    raise exception 'FAIL: member select';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.site_problem_reports (what_happened)
    values ('The button did nothing at all');
    raise exception 'FAIL: member insert';
  exception when insufficient_privilege then null; end;
  begin
    update public.site_problem_reports set status = 'closed';
    raise exception 'FAIL: member update';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.site_problem_reports;
    raise exception 'FAIL: member delete';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
set local role service_role;
do $$
begin
  if (select count(*) from public.site_problem_reports) <> 1 then
    raise exception 'FAIL: service_role cannot read the report';
  end if;
  update public.site_problem_reports set status = 'reviewed', admin_note = 'Saw it';
  if (select status from public.site_problem_reports) is distinct from 'reviewed' then
    raise exception 'FAIL: service_role update';
  end if;
end $$;

rollback;
