CREATE TABLE public.cron_runs (
  id bigserial PRIMARY KEY,
  job_name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  result jsonb,
  error text
);

CREATE INDEX idx_cron_runs_job_started ON public.cron_runs (job_name, started_at DESC);
