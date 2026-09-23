import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isCheckoutEnabled } from '@/lib/checkout-enabled';
import {
  classifyResendSend,
  decideConfirmationPreSend,
  decideReminderPreSend,
  decideStoredRetry,
  emailPayloadsMatch,
  idempotencyKeyExpired,
  type StoredEmailPayload,
} from '@/lib/email-send';

const NOW = new Date('2026-09-23T12:00:00.000Z');

function payload(subject: string): StoredEmailPayload {
  return {
    from: 'Wanderbite <noreply@wanderbite.com>',
    to: 'member@example.com',
    subject,
    html: `<p>${subject}</p>`,
    text: subject,
    headers: {},
  };
}

describe('email send decisions', () => {
  it('keeps checkout fail-closed and the approved AI ceilings', () => {
    expect(isCheckoutEnabled('true')).toBe(true);
    expect(isCheckoutEnabled('TRUE')).toBe(false);
    expect(isCheckoutEnabled('1')).toBe(false);
    expect(isCheckoutEnabled(undefined)).toBe(false);
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260919172836_ai_budget_reservations.sql'),
      'utf8',
    );
    expect(sql).toMatch(/1000000,\n {2}200000,/);
    const reminder = readFileSync(
      path.join(process.cwd(), 'src/app/api/cron/end-of-month-reminder/route.ts'),
      'utf8',
    );
    const vercel = readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8');
    const template = readFileSync(
      path.join(process.cwd(), 'src/emails/redemption-reminder.tsx'),
      'utf8',
    );
    expect(reminder).toContain('export const maxDuration = 300');
    expect(reminder).toContain("status: 'success'");
    expect(vercel).toContain('"schedule": "0 14 25 * *"');
    expect(template).toContain('roll over into the void');
  });

  it('treats a key 24 hours old as expired', () => {
    expect(idempotencyKeyExpired('2026-09-22T12:00:00.000Z', NOW)).toBe(true);
    expect(idempotencyKeyExpired('2026-09-22T12:00:00.001Z', NOW)).toBe(false);
  });

  it('matches suppression by message and classifies uncertain 409s', () => {
    expect(
      classifyResendSend({
        data: null,
        error: { message: 'Recipient is already suppressed', name: 'validation_error', statusCode: 422 },
      }).outcome,
    ).toBe('suppressed');
    expect(
      classifyResendSend({
        data: null,
        error: {
          message: 'concurrent_idempotent_requests',
          name: 'concurrent_idempotent_requests',
          statusCode: 409,
        },
      }).outcome,
    ).toBe('uncertain');
    expect(
      classifyResendSend({
        data: null,
        error: {
          message: 'invalid_idempotent_request',
          name: 'invalid_idempotent_request',
          statusCode: 409,
        },
      }).outcome,
    ).toBe('payload_mismatch');
    expect(classifyResendSend({ data: { id: 'msg_1' }, error: null })).toEqual({
      outcome: 'sent',
      messageId: 'msg_1',
    });
  });

  it('releases a reminder when the unsubscribe secret is missing', () => {
    expect(
      decideReminderPreSend({
        previousStatus: 'pending',
        hasPayload: false,
        usedAt: null,
        optedOut: false,
        suppressed: false,
        hasUnsubscribeSecret: false,
        now: NOW,
      }),
    ).toEqual({ action: 'release', error: 'EMAIL_UNSUBSCRIBE_SECRET not configured' });
  });

  it('skips only opt-out and hard suppression before any send', () => {
    expect(
      decideReminderPreSend({
        previousStatus: 'pending',
        hasPayload: false,
        usedAt: null,
        optedOut: true,
        suppressed: true,
        hasUnsubscribeSecret: true,
        now: NOW,
      }).action,
    ).toBe('skip');
  });

  it('reconciles a changed reminder payload and an expired key without sending', () => {
    const stored = payload('6 days left');
    const fresh = payload('5 days left');
    expect(emailPayloadsMatch(stored, fresh)).toBe(false);
    expect(
      decideStoredRetry({
        stored,
        fresh,
        usedAt: '2026-09-23T11:00:00.000Z',
        now: NOW,
      }),
    ).toEqual({ action: 'reconcile', reason: 'payload_changed' });
    expect(
      decideStoredRetry({
        stored,
        fresh: stored,
        usedAt: '2026-09-22T12:00:00.000Z',
        now: NOW,
      }),
    ).toEqual({ action: 'reconcile', reason: 'idempotency_key_expired' });
    expect(
      decideStoredRetry({
        stored,
        fresh: stored,
        usedAt: '2026-09-23T11:00:00.000Z',
        now: NOW,
      }),
    ).toEqual({ action: 'send_stored' });
  });

  it('still allows a confirmation when the only block would be a topic opt-out', () => {
    expect(
      decideConfirmationPreSend({
        suppressed: false,
        hasPayload: false,
        attemptState: null,
        usedAt: null,
        now: NOW,
      }),
    ).toEqual({ action: 'send_fresh' });
    expect(
      decideConfirmationPreSend({
        suppressed: true,
        hasPayload: false,
        attemptState: null,
        usedAt: null,
        now: NOW,
      }),
    ).toEqual({ action: 'suppress' });
    expect(
      decideConfirmationPreSend({
        suppressed: false,
        hasPayload: true,
        attemptState: 'definite_failure',
        usedAt: '2026-09-22T12:00:00.000Z',
        now: NOW,
      }),
    ).toEqual({ action: 'reconcile', reason: 'idempotency_key_expired' });
  });
});
