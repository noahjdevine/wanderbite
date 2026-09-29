import { describe, expect, it } from 'vitest';
import {
  chicagoMonthStart,
  dailyRunKey,
  httpStatusForCron,
  issueItemStatus,
  monthlyRunKey,
  reminderCronItemStatus,
  resetSwapCountersMonthOpen,
  resetSwapCountersRunKey,
} from '@/lib/cron-period';

describe('G17-E cron period keys', () => {
  it('keeps the monthly key on the same startOfMonth string the generator uses', () => {
    const now = new Date('2026-09-15T18:00:00.000Z');
    expect(monthlyRunKey('issue-monthly-challenges', now)).toBe(
      'issue-monthly-challenges:2026-09-01',
    );
    expect(monthlyRunKey('end-of-month-reminder', new Date('2026-08-25T18:00:00.000Z'))).toBe(
      'end-of-month-reminder:2026-08-01',
    );
  });

  it('keeps Chicago month start on the SQL side of both midnights', () => {
    expect(chicagoMonthStart(new Date('2026-03-01T00:01:00Z'))).toBe('2026-02-01');
    expect(chicagoMonthStart(new Date('2026-03-01T06:00:00Z'))).toBe('2026-03-01');
    expect(chicagoMonthStart(new Date('2026-03-02T07:00:00Z'))).toBe('2026-03-01');
    expect(chicagoMonthStart(new Date('2026-11-01T04:30:00Z'))).toBe('2026-10-01');
    expect(chicagoMonthStart(new Date('2026-11-01T05:00:00Z'))).toBe('2026-11-01');
  });

  it('keys only reset-swap-counters on Chicago and skips a UTC 1st while Chicago is still prior', () => {
    const earlyUtc = new Date('2026-10-01T00:05:00.000Z');
    expect(chicagoMonthStart(earlyUtc)).toBe('2026-09-01');
    expect(resetSwapCountersRunKey(earlyUtc)).toBe('reset-swap-counters:2026-09-01');
    expect(resetSwapCountersMonthOpen(earlyUtc)).toBe(false);
    const chicagoOpen = new Date('2026-10-01T06:05:00.000Z');
    expect(chicagoMonthStart(chicagoOpen)).toBe('2026-10-01');
    expect(resetSwapCountersRunKey(chicagoOpen)).toBe('reset-swap-counters:2026-10-01');
    expect(resetSwapCountersMonthOpen(chicagoOpen)).toBe(true);
    expect(monthlyRunKey('issue-monthly-challenges', new Date('2026-09-15T18:00:00.000Z'))).toBe(
      'issue-monthly-challenges:2026-09-01',
    );
  });

  it('uses the UTC date for daily keys', () => {
    expect(dailyRunKey('stripe-reconcile', new Date('2026-09-24T23:30:00.000Z'))).toBe(
      'stripe-reconcile:2026-09-24',
    );
    expect(dailyRunKey('expire-issued-redemptions', new Date('2026-01-01T00:05:00.000Z'))).toBe(
      'expire-issued-redemptions:2026-01-01',
    );
  });
});

describe('G17-E item outcomes', () => {
  it('does not treat an incomplete cycle as a skip', () => {
    expect(issueItemStatus({ ok: true })).toBe('succeeded');
    expect(issueItemStatus({ ok: false, reason: 'ineligible_address' })).toBe('skipped');
    expect(issueItemStatus({ ok: false, reason: 'invalid_distance_preference' })).toBe('skipped');
    expect(issueItemStatus({ ok: false, reason: 'incomplete_cycle' })).toBe('failed');
    expect(issueItemStatus({ ok: false, reason: 'load_failed' })).toBe('failed');
  });

  it('does not treat an in-flight reminder claim as finished', () => {
    expect(reminderCronItemStatus({ status: 'emailed' }, null)).toBe('succeeded');
    expect(reminderCronItemStatus({ status: 'skipped', reason: 'topic opt-out' }, null)).toBe(
      'skipped',
    );
    expect(reminderCronItemStatus({ status: 'released', reason: 'lost claim' }, null)).toBe(
      'failed',
    );
    expect(reminderCronItemStatus({ status: 'reconciliation', reason: 'uncertain' }, null)).toBe(
      'failed',
    );
    expect(
      reminderCronItemStatus({ status: 'skipped', reason: 'claimed by another worker' }, 'sent'),
    ).toBe('succeeded');
    expect(
      reminderCronItemStatus(
        { status: 'skipped', reason: 'claimed by another worker' },
        'skipped_suppressed',
      ),
    ).toBe('skipped');
    expect(
      reminderCronItemStatus(
        { status: 'skipped', reason: 'claimed by another worker' },
        'needs_reconciliation',
      ),
    ).toBe('failed');
    expect(
      reminderCronItemStatus(
        { status: 'skipped', reason: 'claimed by another worker' },
        'processing',
      ),
    ).toBe('pending');
    expect(
      reminderCronItemStatus({ status: 'skipped', reason: 'claimed by another worker' }, null),
    ).toBe('pending');
  });

  it('maps terminal cron statuses to HTTP', () => {
    expect(httpStatusForCron('success')).toBe(200);
    expect(httpStatusForCron('lease-held')).toBe(409);
    expect(httpStatusForCron('degraded')).toBe(500);
    expect(httpStatusForCron('failed')).toBe(500);
    expect(httpStatusForCron('running')).toBe(500);
  });
});
