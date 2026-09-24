import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const MIGRATION = 'supabase/migrations/20260924161444_g17_e_cron_leases.sql';

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('G17-E cron lease migration', () => {
  const sql = source(MIGRATION).replace(/--[^\n]*/g, '');

  it('adds degraded status, one running row per job and key, and service-role grants', () => {
    expect(sql).toMatch(/status in \('running', 'success', 'failed', 'degraded'\)/);
    expect(sql).toMatch(
      /create unique index cron_runs_one_running_job_key\s+on public\.cron_runs \(job_name, run_key\)\s+where status = 'running'/i,
    );
    expect(sql).toMatch(/create table public\.cron_job_leases/i);
    expect(sql).toMatch(/create table public\.cron_run_items/i);
    expect(sql).toMatch(/primary key \(run_id, item_key\)/i);
    expect(sql).toMatch(/alter table public\.cron_job_leases enable row level security/i);
    expect(sql).toMatch(/alter table public\.cron_run_items enable row level security/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(
      /grant select, insert, update on table public\.cron_job_leases to service_role/i,
    );
    expect(sql).toMatch(
      /grant select, insert, update on table public\.cron_run_items to service_role/i,
    );
    expect(sql).not.toMatch(/grant delete on table public\.cron_job_leases/i);
    expect(sql).not.toMatch(/grant delete on table public\.cron_run_items/i);
    expect(sql).not.toMatch(/security definer/i);
  });

  it('revokes public execute and grants the lease functions only to service_role', () => {
    for (const name of [
      'acquire_cron_lease',
      'renew_cron_lease',
      'record_cron_run_item',
      'release_cron_lease',
      'finalize_cron_lease',
      'cron_run_item_counts',
    ]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\(`, 'i'));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\(`, 'i'));
    }
    expect(sql).toMatch(/from public, anon, authenticated, service_role/i);
    expect(sql).not.toMatch(/grant execute on function public\.acquire_cron_lease[\s\S]*to anon/i);
    expect(sql).not.toMatch(/grant execute on function public\.acquire_cron_lease[\s\S]*to authenticated/i);
  });

  it('rejects success while items are pending or failed, and release cannot set success', () => {
    expect(sql).toMatch(/items-not-clear/);
    expect(sql).toMatch(/period boundary crossed during run/);
    expect(sql).toMatch(/unfinished at period boundary/);
    expect(sql).toMatch(/lease expired before finalize/);
    expect(sql).toMatch(/p_resume_expired/);
    expect(sql).toMatch(/p_allow_new_attempt/);
    const release = sql.slice(sql.indexOf('function public.release_cron_lease'));
    const releaseBody = release.slice(0, release.indexOf('create or replace function public.finalize_cron_lease'));
    expect(releaseBody).not.toMatch(/status = 'success'/);
    expect(releaseBody).toMatch(/status = 'running'/);
  });
});

describe('G17-E cron routes stay on the approved contract', () => {
  it('does not change the six schedules or revive photo refresh', () => {
    const vercel = source('vercel.json');
    expect(vercel).toContain('"path": "/api/cron/issue-monthly-challenges"');
    expect(vercel).toContain('"schedule": "1 0 1 * *"');
    expect(vercel).toContain('"schedule": "5 0 1 * *"');
    expect(vercel).toContain('"schedule": "0 2 * * *"');
    expect(vercel).toContain('"schedule": "* * * * *"');
    expect(vercel).toContain('"schedule": "0 14 25 * *"');
    expect(vercel).toContain('"schedule": "0 3 * * *"');
    expect(vercel).not.toContain('refresh-restaurant-photos');
    const photo = source('src/app/api/cron/refresh-restaurant-photos/route.ts');
    expect(photo).toContain('google_photo_rehost_disabled');
    expect(photo).not.toContain('runLeasedCron');
    expect(photo).not.toContain('places');
  });

  it('does not skip an existing cycle before the generator, and does not resume an old period', () => {
    const issue = source('src/app/api/cron/issue-monthly-challenges/route.ts');
    expect(issue).not.toMatch(/existingCycle/);
    expect(issue).toContain('generateMonthlyChallengeForUser');
    expect(issue).toContain('resumeExpired: true');
    expect(issue).toContain('allowNewAttempt: false');
    expect(issue).toContain('guardPeriod');
    const reminder = source('src/app/api/cron/end-of-month-reminder/route.ts');
    expect(reminder).toContain('readReminderDeliveryStatus');
    expect(reminder).toContain('allowNewAttempt: false');
    const reset = source('src/app/api/cron/reset-swap-counters/route.ts');
    expect(reset).toContain(".lt('cycle_month', currentMonthStr)");
    expect(reset).toContain('allowNewAttempt: false');
    const webhook = source('src/app/api/cron/webhook-outbox/route.ts');
    expect(webhook).toContain('resumeExpired: false');
    expect(webhook).toContain('allowNewAttempt: true');
    expect(webhook).toContain('backlog');
    const expire = source('src/app/api/cron/expire-issued-redemptions/route.ts');
    expect(expire).toContain('EXPIRY_DAYS = 35');
    expect(expire).not.toContain('.range(');
    expect(expire).not.toContain('offset');
  });
});
