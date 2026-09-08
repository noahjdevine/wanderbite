import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendSubscriptionConfirmationEmail = vi.fn();
const captureEvent = vi.fn();

vi.mock('@/lib/resend', () => ({
  sendSubscriptionConfirmationEmail: (...args: unknown[]) =>
    sendSubscriptionConfirmationEmail(...args),
}));

vi.mock('@/lib/posthog-server', () => ({
  captureEvent: (...args: unknown[]) => captureEvent(...args),
}));

import { processWebhookOutbox } from '@/lib/stripe-outbox-worker';

describe('processWebhookOutbox', () => {
  beforeEach(() => {
    sendSubscriptionConfirmationEmail.mockReset();
    captureEvent.mockReset();
    vi.unstubAllEnvs();
  });

  it('treats Resend { data: null, error } as failure and does not mark sent', async () => {
    sendSubscriptionConfirmationEmail.mockResolvedValue({
      ok: false,
      error: 'API key is invalid',
    });
    const rpc = vi.fn(async (fn: string) => {
      if (fn === 'claim_stripe_events_batch') return { data: [], error: null };
      if (fn === 'claim_webhook_outbox_batch') {
        return {
          data: [
            {
              effect_key: 'subscription-confirmation/sub_1',
              effect_type: 'subscription_confirmation_email',
              attempts: 1,
              payload: { userId: 'user-1', to: 'member@example.com', subscriptionId: 'sub_1' },
            },
          ],
          error: null,
        };
      }
      if (fn === 'fail_webhook_outbox') return { data: true, error: null };
      if (fn === 'complete_webhook_outbox') return { data: true, error: null };
      if (fn === 'purge_stripe_event_payloads') return { data: 0, error: null };
      return { data: null, error: { message: fn } };
    });

    const result = await processWebhookOutbox({
      supabase: { rpc } as never,
      stripe: {} as never,
    });

    expect(result.outboxErrors).toBe(1);
    expect(rpc.mock.calls.some((call) => call[0] === 'fail_webhook_outbox')).toBe(true);
    expect(rpc.mock.calls.some((call) => call[0] === 'complete_webhook_outbox')).toBe(false);
  });

  it('does not let a stolen claim token mark the row sent after a successful provider accept', async () => {
    sendSubscriptionConfirmationEmail.mockResolvedValue({ ok: true });
    const rpc = vi.fn(async (fn: string) => {
      if (fn === 'claim_stripe_events_batch') return { data: [], error: null };
      if (fn === 'claim_webhook_outbox_batch') {
        return {
          data: [
            {
              effect_key: 'subscription-confirmation/sub_1',
              effect_type: 'subscription_confirmation_email',
              attempts: 1,
              payload: { to: 'member@example.com', userId: 'user-1', subscriptionId: 'sub_1' },
            },
          ],
          error: null,
        };
      }
      if (fn === 'complete_webhook_outbox') return { data: false, error: null };
      if (fn === 'purge_stripe_event_payloads') return { data: 0, error: null };
      return { data: null, error: { message: fn } };
    });

    const result = await processWebhookOutbox({
      supabase: { rpc } as never,
      stripe: {} as never,
    });

    expect(result.outboxErrors).toBe(0);
    expect(sendSubscriptionConfirmationEmail).toHaveBeenCalledWith(
      'member@example.com',
      'subscription-confirmation/sub_1'
    );
    expect(rpc.mock.calls.some((call) => call[0] === 'fail_webhook_outbox')).toBe(false);
  });
});
