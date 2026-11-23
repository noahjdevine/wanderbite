-- Site problem reports.
-- NOT applied to hosted. Forward-only. Noah approves any apply.
-- Members and signed-out visitors tell us about broken pages.
-- This is not a visit problem. visit_problem_* tables are unchanged.
-- No member or anon select, update, or delete. Inserts are service role only.
-- Does not store IP addresses.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.site_problem_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  contact_email text,
  page_path text,
  what_happened text not null,
  trying_to_do text,
  user_agent text,
  status text not null default 'new',
  admin_note text,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  constraint site_problem_reports_what_happened_len
    check (char_length(what_happened) between 10 and 2000),
  constraint site_problem_reports_trying_to_do_len
    check (trying_to_do is null or char_length(trying_to_do) between 1 and 1000),
  constraint site_problem_reports_contact_email_len
    check (
      contact_email is null
      or (
        char_length(contact_email) between 3 and 254
        and position('@' in contact_email) > 1
      )
    ),
  constraint site_problem_reports_page_path_check
    check (
      page_path is null
      or (
        char_length(page_path) between 1 and 300
        and left(page_path, 1) = '/'
        and left(page_path, 2) <> '//'
        and position('://' in page_path) = 0
        and position(chr(92) in page_path) = 0
        and position(chr(10) in page_path) = 0
        and position(chr(13) in page_path) = 0
      )
    ),
  constraint site_problem_reports_user_agent_len
    check (user_agent is null or char_length(user_agent) between 1 and 300),
  constraint site_problem_reports_status_check
    check (status in ('new', 'reviewed', 'closed')),
  constraint site_problem_reports_admin_note_len
    check (admin_note is null or char_length(admin_note) between 1 and 500)
);

create index site_problem_reports_created_at_idx
  on public.site_problem_reports (created_at desc);

comment on table public.site_problem_reports is
  'Site issue reports from members and visitors. Not a visit problem. Service role only. No IP address column.';

comment on column public.site_problem_reports.user_agent is
  'Browser user agent, truncated to 300 characters. Not an IP address.';

alter table public.site_problem_reports enable row level security;

revoke all on table public.site_problem_reports
  from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.site_problem_reports to service_role;
