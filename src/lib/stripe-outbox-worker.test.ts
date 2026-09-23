import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildSubscriptionConfirmationEmail = vi.fn();
const sendStoredEmail = vi.fn();
const captureEvent = vi.fn();

vi.mock('@/lib/resend', () => ({
  buildSubscriptionConfirmationEmail: (...args: unknown[]) =>
    buildSubscriptionConfirmationEmail(...args),
  sendStoredEmail: (...args: unknown[]) => sendStoredEmail(...args),
}));

vi.mock('@/lib/posthog-server', () => ({
  captureEvent: (...args: unknown[]) => captureEvent(...args),
}));

import { processWebhookOutbox } from '@/lib/stripe-outbox-worker';

const FRESH = {
  from: 'Wanderbite <noreply@wanderbite.com>',
  to: 'member@example.com',
  subject: 'Your Wanderbite subscription is active',
  html: '<p>Welcome</p>',
  text: 'Welcome',
  headers: {},
};

function confirmationRow(overrides: Record<string, unknown> = {}) {
  return {
    effect_key: 'subscription-confirmation/sub_1',
    effect_type: 'subscription_confirmation_email',
    attempts: 1,
    payload: { userId: 'user-1', to: 'member@example.com', subscriptionId: 'sub_1' },
    recipient_email: null,
    email_payload: null,
    idempotency_key_used_at: null,
    email_attempt_state: null,
    ...overrides,
  };
}

function admin(options: {
  row?: Record<string, unknown> | null;
  suppressed?: boolean;
  rpcResult?: (fn: string) => unknown;
}) {
  const calls: { fn: string; args: unknown }[] = [];
  const tables: string[] = [];
  const rpc = vi.fn(async (fn: string, args?: unknown) => {
    calls.push({ fn, args });
    if (fn === 'claim_stripe_events_batch') return { data: [], error: null };
    if (fn === 'claim_webhook_outbox_batch') {
      return { data: options.row === null ? [] : [options.row ?? confirmationRow()], error: null };
    }
    if (fn === 'purge_stripe_event_payloads') return { data: 0, error: null };
    if (options.rpcResult) return { data: options.rpcResult(fn), error: null };
    if (
      fn === 'store_webhook_outbox_email' ||
      fn === 'mark_webhook_outbox_definite_failure' ||
      fn === 'complete_webhook_outbox_email' ||
      fn === 'suppress_webhook_outbox' ||
      fn === 'reconcile_webhook_outbox' ||
      fn === 'record_hard_email_suppression' ||
      fn === 'fail_webhook_outbox' ||
      fn === 'complete_webhook_outbox'
    ) {
      return { data: true, error: null };
    }
    return { data: null, error: { message: fn } };
  });
  const from = vi.fn((table: string) => {
    tables.push(table);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'email_suppressions' && options.suppressed
              ? { normalized_address: 'member@example.com' }
              : null,
            error: null,
          }),
        }),
      }),
    };
  });
  return { client: { rpc, from } as never, calls, tables };
}

describe('processWebhookOutbox confirmation delivery', () => {
  beforeEach(() => {
    buildSubscriptionConfirmationEmail.mockReset();
    sendStoredEmail.mockReset();
    captureEvent.mockReset();
    buildSubscriptionConfirmationEmail.mockResolvedValue(FRESH);
    vi.unstubAllEnvs();
    vi.stubEnv('RESEND_API_KEY', 're_test');
  });

  it('treats a definite Resend rejection as a fenced failure and does not mark sent', async () => {
    sendStoredEmail.mockResolvedValue({ outcome: 'definite_failure', error: 'API key is invalid' });
    const { client, calls } = admin({});
    const result = await processWebhookOutbox({ supabase: client, stripe: {} as never });
    expect(result.outboxErrors).toBe(1);
    expect(calls.some((call) => call.fn === 'fail_webhook_outbox')).toBe(true);
    expect(calls.some((call) => call.fn === 'mark_webhook_outbox_definite_failure')).toBe(true);
    expect(calls.some((call) => call.fn === 'complete_webhook_outbox_email')).toBe(false);
  });

  it('does not let a stolen claim token mark the row sent after a successful provider accept', async () => {
    sendStoredEmail.mockResolvedValue({ outcome: 'sent', messageId: 'msg_1' });
    const { client, calls } = admin({
      rpcResult: (fn) => (fn === 'complete_webhook_outbox_email' ? false : true),
    });
    const result = await processWebhookOutbox({ supabase: client, stripe: {} as never });
    expect(result.outboxErrors).toBe(0);
    expect(sendStoredEmail).toHaveBeenCalledWith(FRESH, 'subscription-confirmation/sub_1');
    expect(calls.some((call) => call.fn === 'fail_webhook_outbox')).toBe(false);
  });

  it('sends the confirmation when the member opted out of adventure reminders', async () => {
    sendStoredEmail.mockResolvedValue({ outcome: 'sent', messageId: 'msg_1' });
    const { client, tables, calls } = admin({});
    await processWebhookOutbox({ supabase: client, stripe: {} as never });
    expect(tables).not.toContain('email_topic_preferences');
    expect(sendStoredEmail).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.fn === 'complete_webhook_outbox_email')).toBe(true);
    const complete = calls.find((call) => call.fn === 'complete_webhook_outbox_email');
    expect(complete?.args).toMatchObject({ p_message_id: 'msg_1' });
  });

  it('does not call Resend or the 14-day fail path when the address is already suppressed', async () => {
    const { client, calls } = admin({ suppressed: true });
    const result = await processWebhookOutbox({ supabase: client, stripe: {} as never });
    expect(result.outboxErrors).toBe(0);
    expect(sendStoredEmail).not.toHaveBeenCalled();
    expect(calls.some((call) => call.fn === 'suppress_webhook_outbox')).toBe(true);
    expect(calls.some((call) => call.fn === 'fail_webhook_outbox')).toBe(false);
  });

  it('records a synchronous already-suppressed result without failing the outbox', async () => {
    sendStoredEmail.mockResolvedValue({
      outcome: 'suppressed',
      error: 'This recipient is on the suppression list',
    });
    const { client, calls } = admin({});
    const result = await processWebhookOutbox({ supabase: client, stripe: {} as never });
    expect(result.outboxErrors).toBe(0);
    expect(calls.map((call) => call.fn)).toEqual(
      expect.arrayContaining(['record_hard_email_suppression', 'suppress_webhook_outbox']),
    );
    expect(calls.some((call) => call.fn === 'fail_webhook_outbox')).toBe(false);
  });

  it('reconciles an expired confirmation key instead of calling Resend again', async () => {
    const { client, calls } = admin({
      row: confirmationRow({
        email_payload: FRESH,
        email_attempt_state: 'definite_failure',
        idempotency_key_used_at: '2020-01-01T00:00:00.000Z',
      }),
    });
    await processWebhookOutbox({ supabase: client, stripe: {} as never });
    expect(sendStoredEmail).not.toHaveBeenCalled();
    expect(calls.some((call) => call.fn === 'reconcile_webhook_outbox')).toBe(true);
    expect(calls.some((call) => call.fn === 'fail_webhook_outbox')).toBe(false);
  });

  it('retries the stored confirmation payload inside 24 hours', async () => {
    const stored = { ...FRESH, subject: 'stored subject' };
    sendStoredEmail.mockResolvedValue({ outcome: 'sent', messageId: 'msg_stored' });
    buildSubscriptionConfirmationEmail.mockResolvedValue(stored);
    const { client } = admin({
      row: confirmationRow({
        email_payload: stored,
        email_attempt_state: 'definite_failure',
        idempotency_key_used_at: new Date().toISOString(),
      }),
    });
    await processWebhookOutbox({ supabase: client, stripe: {} as never });
    expect(sendStoredEmail).toHaveBeenCalledWith(stored, 'subscription-confirmation/sub_1');
  });

  it('reconciles when a fresh confirmation render differs from the stored payload', async () => {
    const { client, calls } = admin({
      row: confirmationRow({
        email_payload: { ...FRESH, subject: 'old subject' },
        email_attempt_state: 'definite_failure',
        idempotency_key_used_at: new Date().toISOString(),
      }),
    });
    await processWebhookOutbox({ supabase: client, stripe: {} as never });
    expect(sendStoredEmail).not.toHaveBeenCalled();
    const reconcile = calls.find((call) => call.fn === 'reconcile_webhook_outbox');
    expect(reconcile?.args).toMatchObject({ p_reason: 'payload_changed' });
  });
});
