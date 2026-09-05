-- OPS-03: 022 created cron_runs without RLS. Live has RLS enabled and no
-- policies (service role only). Enable RLS so a fresh apply matches that
-- deny-by-default shape. Do not add policies here (SEC-06 catalog/grants).

alter table public.cron_runs enable row level security;
