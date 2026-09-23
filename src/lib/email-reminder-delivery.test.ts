import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildRedemptionReminderEmail = vi.fn();
const sendStoredEmail = vi.fn();

vi.mock('@/lib/resend', () => ({
  buildRedemptionReminderEmail: (...args: unknown[]) => buildRedemptionReminderEmail(...args),
  sendStoredEmail: (...args: unknown[]) => sendStoredEmail(...args),
  emailBaseUrl: () => 'https://wanderbite.test',
}));

import { deliverAdventureReminder } from '@/lib/email-reminder-delivery';

const USER = '15000000-0000-4000-8000-000000000001';
const MONTH = '2026-09-01';

function claim(overrides: Record<string, unknown> = {}) {
  return {
    user_id: USER,
    cycle_month: MONTH,
    status: 'processing',
    claim_token: 'token',
    claimed_at: new Date().toISOString(),
    claim_expires_at: new Date(Date.now() + 600_000).toISOString(),
    recipient_email: null,
    email_payload: null,
    idempotency_key: null,
    idempotency_key_used_at: null,
    resend_message_id: null,
    reconciliation_reason: null,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    previous_status: 'pending',
    ...overrides,
  };
}

function payload(daysLeft: number, names: string[]) {
  return {
    from: 'Wanderbite <noreply@wanderbite.com>',
    to: 'member@example.com',
    subject: `${daysLeft} days`,
    html: names.join('|'),
    text: names.join('|'),
    headers: {
      'List-Unsubscribe': '<https://wanderbite.test/email/unsubscribe?token=abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

function admin(options: {
  claims?: unknown[];
  optedOut?: boolean;
  suppressed?: boolean;
  rpcResult?: (fn: string) => unknown;
}) {
  const calls: { fn: string; args: unknown }[] = [];
  let claimIndex = 0;
  const rpc = vi.fn(async (fn: string, args?: unknown) => {
    calls.push({ fn, args });
    if (fn === 'claim_email_reminder_delivery') {
      const row = options.claims?.[claimIndex] ?? null;
      claimIndex += 1;
      return { data: row ? [row] : [], error: null };
    }
    if (options.rpcResult) return { data: options.rpcResult(fn), error: null };
    return { data: fn === 'ensure_email_reminder_delivery' ? null : true, error: null };
  });
  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'email_topic_preferences' && options.optedOut
              ? { opted_out: true }
              : null,
            error: null,
          }),
        }),
        maybeSingle: async () => ({
          data: table === 'email_suppressions' && options.suppressed
            ? { normalized_address: 'member@example.com' }
            : null,
          error: null,
        }),
      }),
    }),
  }));
  return { client: { rpc, from } as never, calls };
}

describe('deliverAdventureReminder', () => {
  beforeEach(() => {
    buildRedemptionReminderEmail.mockReset();
    sendStoredEmail.mockReset();
    buildRedemptionReminderEmail.mockImplementation(async (input: { daysLeft: number; restaurantNames: string[] }) =>
      payload(input.daysLeft, input.restaurantNames),
    );
    vi.unstubAllEnvs();
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'current-secret');
    vi.stubEnv('RESEND_API_KEY', 're_test');
  });

  it('lets one overlapping claim send and leaves the loser unsent', async () => {
    const first = admin({ claims: [claim()] });
    const second = admin({ claims: [] });
    sendStoredEmail.mockResolvedValue({ outcome: 'sent', messageId: 'msg_1' });
    const won = await deliverAdventureReminder({
      supabase: first.client,
      userId: USER,
      cycleMonth: MONTH,
      email: 'member@example.com',
      restaurantNames: ['Ada'],
      daysLeft: 6,
    });
    const lost = await deliverAdventureReminder({
      supabase: second.client,
      userId: USER,
      cycleMonth: MONTH,
      email: 'member@example.com',
      restaurantNames: ['Ada'],
      daysLeft: 6,
    });
    expect(won.status).toBe('emailed');
    expect(lost).toEqual({ status: 'skipped', reason: 'claimed by another worker' });
    expect(sendStoredEmail).toHaveBeenCalledTimes(1);
  });

  it('does not call Resend for opt-out or hard suppression', async () => {
    const opted = admin({ claims: [claim()], optedOut: true });
    const blocked = admin({ claims: [claim()], suppressed: true });
    const optResult = await deliverAdventureReminder({
      supabase: opted.client,
      userId: USER,
      cycleMonth: MONTH,
      email: 'Member@Example.com',
      restaurantNames: ['Ada'],
      daysLeft: 6,
    });
    const blockResult = await deliverAdventureReminder({
      supabase: blocked.client,
      userId: USER,
      cycleMonth: MONTH,
      email: 'member@example.com',
      restaurantNames: ['Ada'],
      daysLeft: 6,
    });
    expect(optResult).toMatchObject({ status: 'skipped', reason: 'topic opt-out' });
    expect(blockResult).toMatchObject({ status: 'skipped', reason: 'hard suppression' });
    expect(sendStoredEmail).not.toHaveBeenCalled();
    expect(opted.calls.some((call) => call.fn === 'skip_email_reminder_delivery')).toBe(true);
  });

  it('releases the claim when EMAIL_UNSUBSCRIBE_SECRET is missing', async () => {
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', '');
    const { client, calls } = admin({ claims: [claim()] });
    const result = await deliverAdventureReminder({
      supabase: client,
      userId: USER,
      cycleMonth: MONTH,
      email: 'member@example.com',
      restaurantNames: ['Ada'],
      daysLeft: 6,
    });
    expect(result.status).toBe('released');
    expect(sendStoredEmail).not.toHaveBeenCalled();
    expect(calls.some((call) => call.fn === 'skip_email_reminder_delivery')).toBe(false);
    expect(calls.some((call) => call.fn === 'release_email_reminder_delivery')).toBe(true);
  });

  it('stores the message id and retries the stored payload inside 24 hours', async () => {
    const stored = payload(6, ['Ada']);
    sendStoredEmail.mockResolvedValue({ outcome: 'sent', messageId: 'msg_retry' });
    const freshRun = admin({ claims: [claim()] });
    await deliverAdventureReminder({
      supabase: freshRun.client,
      userId: USER,
      cycleMonth: MONTH,
      email: 'member@example.com',
      restaurantNames: ['Ada'],
      daysLeft: 6,
    });
    const storedCall = freshRun.calls.find((call) => call.fn === 'store_email_reminder_payload');
    expect(storedCall?.args).toMatchObject({
      p_idempotency_key: `adventure-reminder/${USER}/${MONTH}`,
      p_recipient: 'member@example.com',
    });
    const complete = freshRun.calls.find((call) => call.fn === 'complete_email_reminder_delivery');
    expect(complete?.args).toMatchObject({ p_message_id: 'msg_retry' });

    sendStoredEmail.mockClear();
    buildRedemptionReminderEmail.mockClear();
    const retry = admin({
      claims: [
        claim({
          previous_status: 'failed',
          email_payload: stored,
          idempotency_key: `adventure-reminder/${USER}/${MONTH}`,
          idempotency_key_used_at: new Date().toISOString(),
          recipient_email: 'member@example.com',
        }),
      ],
    });
    const result = await deliverAdventureReminder({
      supabase: retry.client,
      userId: USER,
      cycleMonth: MONTH,
      email: 'member@example.com',
      restaurantNames: ['Ada'],
      daysLeft: 6,
    });
    expect(result.status).toBe('emailed');
    expect(sendStoredEmail).toHaveBeenCalledWith(stored, `adventure-reminder/${USER}/${MONTH}`);
    expect(retry.calls.some((call) => call.fn === 'store_email_reminder_payload')).toBe(false);
  });

  it('reconciles a changed restaurant list, an uncertain send, and an expired key', async () => {
    const stored = payload(6, ['Ada']);
    const changed = admin({
      claims: [
        claim({
          previous_status: 'failed',
          email_payload: stored,
          idempotency_key_used_at: new Date().toISOString(),
        }),
      ],
    });
    const changedResult = await deliverAdventureReminder({
      supabase: changed.client,
      userId: USER,
      cycleMonth: MONTH,
      email: 'member@example.com',
      restaurantNames: ['Bea'],
      daysLeft: 6,
    });
    expect(changedResult).toMatchObject({ status: 'reconciliation', reason: 'payload_changed' });

    sendStoredEmail.mockResolvedValue({ outcome: 'uncertain', error: 'timeout' });
    const uncertain = admin({ claims: [claim()] });
    const uncertainResult = await deliverAdventureReminder({
      supabase: uncertain.client,
      userId: USER,
      cycleMonth: MONTH,
      email: 'member@example.com',
      restaurantNames: ['Ada'],
      daysLeft: 6,
    });
    expect(uncertainResult).toMatchObject({ status: 'reconciliation', reason: 'uncertain_send' });

    const expired = admin({
      claims: [
        claim({
          previous_status: 'failed',
          email_payload: stored,
          idempotency_key_used_at: '2020-01-01T00:00:00.000Z',
        }),
      ],
    });
    const expiredResult = await deliverAdventureReminder({
      supabase: expired.client,
      userId: USER,
      cycleMonth: MONTH,
      email: 'member@example.com',
      restaurantNames: ['Ada'],
      daysLeft: 6,
    });
    expect(expiredResult).toMatchObject({ status: 'reconciliation', reason: 'idempotency_key_expired' });
    expect(sendStoredEmail).toHaveBeenCalledTimes(1);
  });
});
