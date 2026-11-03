import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMonthlyRevealUnavailableLog } from '@/lib/challenges/monthly-reveal-flag';

const gate = vi.hoisted(() => ({
  shows: true,
  revealRow: null as { id: string } | null,
  revealError: null as { code: string; message: string } | null,
  claimCount: 0,
  sends: [] as string[],
}));

vi.mock('@/lib/challenges/monthly-cron-gate', () => ({
  memberShowsMonthlyCuration: () => Promise.resolve(gate.shows),
}));

vi.mock('@/lib/resend', async () => {
  const actual = await vi.importActual<typeof import('@/lib/resend')>('@/lib/resend');
  return {
    ...actual,
    sendStoredEmail: async (_payload: unknown, key: string) => {
      gate.sends.push(key);
      return { outcome: 'sent' as const, messageId: 'msg-1' };
    },
  };
});

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle() {
          if (table === 'challenge_reveals') {
            return Promise.resolve({ data: gate.revealRow, error: gate.revealError });
          }
          if (table === 'user_profiles') {
            return Promise.resolve({ data: { email: 'member@example.com' }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return api;
    },
    rpc(fn: string) {
      if (fn === 'claim_reveal_pick_reminder') {
        gate.claimCount += 1;
        if (gate.claimCount > 1) return Promise.resolve({ data: [], error: null });
        return Promise.resolve({
          data: [{
            previous_status: 'pending',
            email_payload: null,
            idempotency_key: null,
            idempotency_key_used_at: null,
          }],
          error: null,
        });
      }
      return Promise.resolve({ data: true, error: null });
    },
  }),
}));

import { decideRevealPickSend, deliverRevealPickReminder } from '@/lib/reveal-pick-reminder';
import { buildRevealPickReminderEmail } from '@/lib/resend';

const USER = '11111111-1111-4111-8111-111111111111';
const ROOT = path.resolve(__dirname, '../..');

describe('reveal pick reminder', () => {
  beforeEach(() => {
    gate.shows = true;
    gate.revealRow = null;
    gate.revealError = null;
    gate.claimCount = 0;
    gate.sends.length = 0;
    process.env.E04_MONTHLY_REVEAL_ENABLED = 'true';
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret';
    resetMonthlyRevealUnavailableLog();
  });

  it('sends nothing when the flag is off', async () => {
    delete process.env.E04_MONTHLY_REVEAL_ENABLED;
    const result = await deliverRevealPickReminder({ userId: USER });
    expect(result).toEqual({ status: 'skipped', reason: 'flag off' });
    expect(gate.sends).toEqual([]);
    expect(gate.claimCount).toBe(0);
  });

  it('sends once to an eligible member and does not send again', async () => {
    const first = await deliverRevealPickReminder({ userId: USER });
    const second = await deliverRevealPickReminder({ userId: USER });
    expect(first.status).toBe('emailed');
    expect(second).toMatchObject({ status: 'skipped', reason: 'already sent or claimed' });
    expect(gate.sends).toHaveLength(1);
    expect(gate.sends[0]).toContain(USER);
    expect(gate.claimCount).toBe(2);
  });

  it('does not send to credits, out-of-area, already-paired, or already-revealed members', async () => {
    gate.shows = false;
    expect((await deliverRevealPickReminder({ userId: USER })).status).toBe('skipped');
    expect(gate.sends).toEqual([]);

    gate.shows = true;
    gate.revealRow = { id: 'reveal-1' };
    expect((await deliverRevealPickReminder({ userId: USER })).status).toBe('skipped');
    expect(gate.sends).toEqual([]);
    expect(gate.claimCount).toBe(0);
  });

  it('sends nothing when the reveal read is not the schema', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gate.revealError = { code: '500', message: 'upstream connect error' };
    const first = await deliverRevealPickReminder({ userId: USER });
    const second = await deliverRevealPickReminder({ userId: USER });
    expect(first).toMatchObject({ status: 'skipped', reason: 'reveal read failed' });
    expect(second.status).toBe('skipped');
    expect(gate.sends).toEqual([]);
    expect(gate.claimCount).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(USER);
  });

  it('classifies the send decision without copying the curation rule', () => {
    expect(decideRevealPickSend({
      flagOn: false,
      showsCuration: true,
      hasRevealRow: false,
      revealRead: 'ok',
    })).toBe('skip');
    expect(decideRevealPickSend({
      flagOn: true,
      showsCuration: false,
      hasRevealRow: false,
      revealRead: 'ok',
    })).toBe('skip');
    expect(decideRevealPickSend({
      flagOn: true,
      showsCuration: true,
      hasRevealRow: true,
      revealRead: 'ok',
    })).toBe('skip');
    expect(decideRevealPickSend({
      flagOn: true,
      showsCuration: true,
      hasRevealRow: false,
      revealRead: 'error',
    })).toBe('skip');
    expect(decideRevealPickSend({
      flagOn: true,
      showsCuration: true,
      hasRevealRow: false,
      revealRead: 'ok',
    })).toBe('send');
  });

  it('links the message to /challenges and keeps the unsubscribe control', async () => {
    const message = await buildRevealPickReminderEmail({
      to: 'member@example.com',
      unsubscribeUrl: 'https://wanderbite.test/email/unsubscribe?token=abc',
    });
    expect(message.subject).toBe('Your challenges for this month are ready to pick');
    expect(message.html).toContain('/challenges');
    expect(message.text).toContain('/challenges');
    expect(message.html).toContain('https://wanderbite.test/email/unsubscribe?token=abc');
    expect(message.headers['List-Unsubscribe']).toContain('unsubscribe');
  });

  it('sends only from the curation skip branch of the existing monthly crons', () => {
    for (const rel of [
      'src/app/api/cron/issue-monthly-challenges/route.ts',
      'src/app/api/cron/issue-version-bound-challenges/route.ts',
    ]) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      const callAt = source.indexOf('deliverRevealPickReminder(');
      const unknownAt = source.indexOf('skippedUnknown += 1');
      expect(callAt).toBeGreaterThan(-1);
      expect(callAt).toBeLessThan(unknownAt);
      expect(source.split('deliverRevealPickReminder(').length - 1).toBe(1);
    }
  });
});
