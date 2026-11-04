import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  REDEMPTION_CODE_LIFETIME_LABEL,
  REDEMPTION_TTL_MINUTES,
  capRedemptionExpiresAt,
  formatRedemptionCountdown,
  redemptionExpiresAt,
  selectIssuedCodesToExpire,
} from '@/lib/redemption-expiry';

const ROOT = path.resolve(__dirname, '../..');

function chicagoClock(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

function expiresUnderTz(tz: string, iso: string): string {
  const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const result = spawnSync(
    tsx,
    [
      '-e',
      `import { capRedemptionExpiresAt, redemptionExpiresAt } from './src/lib/redemption-expiry.ts';
       const from = new Date(${JSON.stringify(iso)});
       const deadline = new Date('2026-11-05T01:05:00.000Z');
       const open = redemptionExpiresAt(from).toISOString();
       const capped = capRedemptionExpiresAt(redemptionExpiresAt(from), deadline).toISOString();
       process.stdout.write(open + '|' + capped);`,
    ],
    { cwd: process.cwd(), env: { ...process.env, TZ: tz }, encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe('redemption code lifetime', () => {
  it('is 15 minutes from 7:00 PM CT, including across the Chicago spring-forward', () => {
    expect(REDEMPTION_TTL_MINUTES).toBe(15);
    expect(REDEMPTION_CODE_LIFETIME_LABEL).toBe('15 minutes');
    const sevenPm = new Date('2026-11-05T01:00:00.000Z');
    const expires = redemptionExpiresAt(sevenPm);
    expect(expires.toISOString()).toBe('2026-11-05T01:15:00.000Z');
    expect(chicagoClock(sevenPm.toISOString())).toBe('19:00');
    expect(chicagoClock(expires.toISOString())).toBe('19:15');
    expect(expires.getTime() - sevenPm.getTime()).toBe(15 * 60 * 1000);

    const beforeSpring = new Date('2026-03-08T07:50:00.000Z');
    const afterSpring = redemptionExpiresAt(beforeSpring);
    expect(afterSpring.toISOString()).toBe('2026-03-08T08:05:00.000Z');
    expect(chicagoClock(beforeSpring.toISOString())).toBe('01:50');
    expect(chicagoClock(afterSpring.toISOString())).toBe('03:05');

    const utc = expiresUnderTz('UTC', sevenPm.toISOString());
    const chicago = expiresUnderTz('America/Chicago', sevenPm.toISOString());
    expect(utc).toBe('2026-11-05T01:15:00.000Z|2026-11-05T01:05:00.000Z');
    expect(chicago).toBe(utc);
  });

  it('caps a new code at the visit window and leaves a null deadline at 15 minutes', () => {
    const from = new Date('2026-11-05T01:00:00.000Z');
    const fiveMinutes = new Date('2026-11-05T01:05:00.000Z');
    expect(capRedemptionExpiresAt(redemptionExpiresAt(from), fiveMinutes).toISOString()).toBe(
      fiveMinutes.toISOString(),
    );
    const later = new Date('2026-11-20T01:00:00.000Z');
    expect(capRedemptionExpiresAt(redemptionExpiresAt(from), later).toISOString()).toBe(
      '2026-11-05T01:15:00.000Z',
    );
    expect(capRedemptionExpiresAt(redemptionExpiresAt(from), null).toISOString()).toBe(
      '2026-11-05T01:15:00.000Z',
    );
  });

  it('counts down from a deadline instead of starting at 15:00', () => {
    expect(formatRedemptionCountdown(14 * 60 * 1000)).toBe('14:00');
    expect(formatRedemptionCountdown(15 * 60 * 1000)).toBe('15:00');
    expect(formatRedemptionCountdown(90 * 1000)).toBe('01:30');
    expect(formatRedemptionCountdown(0)).toBe('00:00');
  });

  it('selects issued codes past expires_at and does not select the challenge item', () => {
    const asOf = new Date('2026-11-05T01:16:00.000Z');
    expect(
      selectIssuedCodesToExpire(
        [
          { id: 'live', status: 'issued', expiresAt: '2026-11-05T01:20:00.000Z' },
          { id: 'stale', status: 'issued', expiresAt: '2026-11-05T01:15:00.000Z' },
          { id: 'marked', status: 'expired', expiresAt: '2026-11-05T01:00:00.000Z' },
          { id: 'used', status: 'verified', expiresAt: '2026-11-05T01:00:00.000Z' },
        ],
        asOf,
      ),
    ).toEqual(['stale']);
  });

  it('keeps the migration from rewriting stored deadlines', () => {
    const sql = readFileSync(
      path.join(ROOT, 'supabase/migrations/20261104034332_redemption_code_ttl.sql'),
      'utf8',
    );
    expect(sql).toMatch(/least\(p_expires_at, source\.redemption_deadline\)/);
    expect(sql).toMatch(/'reissued'/);
    expect(sql).toMatch(/interval '15 minutes'/);
    expect(sql).not.toMatch(/update public\.redemptions\s+set expires_at/i);
  });
});
