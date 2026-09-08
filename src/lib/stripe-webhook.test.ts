import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import {
  canceledEffectKey,
  confirmationEffectKey,
  handleStripeWebhookEvent,
  startedEffectKey,
} from '@/lib/stripe-webhook';

const USER_ID = '40000000-0000-4000-8000-000000000001';

type RpcCall = { fn: string; args: Record<string, unknown> };

function baseEvent(type: Stripe.Event['type'], object: object, id = 'evt_1'): Stripe.Event {
  return {
    id,
    object: 'event',
    type,
    livemode: false,
    api_version: '2026-01-01',
    created: 1_700_000_000,
    data: { object },
  } as Stripe.Event;
}

function subscription(overrides: {
  id?: string;
  status: string;
  customer?: string | Stripe.Customer;
  metadata?: Stripe.Metadata;
}): Stripe.Subscription {
  return {
    id: overrides.id ?? 'sub_1',
    object: 'subscription',
    customer: overrides.customer ?? 'cus_1',
    status: overrides.status,
    metadata: overrides.metadata ?? { userId: USER_ID },
    items: { data: [{ current_period_end: 1_700_086_400 }] },
  } as Stripe.Subscription;
}

function createHarness(options?: {
  insertStatus?: string;
  claim?: boolean;
  complete?: boolean;
  profiles?: Array<{
    id: string;
    email: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  }>;
  updateRows?: Array<{ id: string }> | null;
  subscriptions?: Record<string, Stripe.Subscription>;
}) {
  const rpcCalls: RpcCall[] = [];
  const updates: Record<string, unknown>[] = [];
  const profiles = options?.profiles ?? [
    {
      id: USER_ID,
      email: 'member@example.com',
      stripe_customer_id: null,
      stripe_subscription_id: null,
    },
  ];
  const supabase = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === 'insert_stripe_event') {
        return {
          data: {
            event_id: args.p_event_id,
            status: options?.insertStatus ?? 'received',
            payload: args.p_payload,
          },
          error: null,
        };
      }
      if (fn === 'claim_stripe_event') return { data: options?.claim ?? true, error: null };
      if (fn === 'complete_stripe_event') return { data: options?.complete ?? true, error: null };
      if (fn === 'fail_stripe_event') return { data: true, error: null };
      if (fn === 'enqueue_webhook_outbox') return { data: true, error: null };
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    }),
    from: vi.fn((table: string) => {
      if (table !== 'user_profiles') {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: async (column: string, value: string) => {
            const data = profiles.filter((row) => {
              if (column === 'id') return row.id === value;
              if (column === 'stripe_customer_id') return row.stripe_customer_id === value;
              return false;
            });
            return { data, error: null };
          },
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            select: async () => {
              updates.push(patch);
              if (options?.updateRows === null) return { data: [], error: null };
              return { data: options?.updateRows ?? [{ id: USER_ID }], error: null };
            },
          }),
        }),
      };
    }),
  };

  const retrieve = vi.fn(async (id: string) => {
    const found = options?.subscriptions?.[id];
    if (!found) throw new Error(`unknown subscription ${id}`);
    return found;
  });

  return {
    rpcCalls,
    updates,
    supabase,
    stripe: { subscriptions: { retrieve } },
    retrieve,
  };
}

describe('handleStripeWebhookEvent', () => {
  it('activates a member and enqueues confirmation once without sending email', async () => {
    const sub = subscription({ status: 'active' });
    const harness = createHarness({ subscriptions: { sub_1: sub } });
    const result = await handleStripeWebhookEvent({
      event: baseEvent('checkout.session.completed', {
        id: 'cs_1',
        subscription: 'sub_1',
        metadata: { userId: USER_ID },
        client_reference_id: USER_ID,
        customer_email: 'member@example.com',
      }),
      supabase: harness.supabase as never,
      stripe: harness.stripe as never,
    });

    expect(result).toEqual({ httpStatus: 200, body: { received: true } });
    expect(harness.updates[0]).toMatchObject({
      subscription_status: 'active',
      stripe_subscription_id: 'sub_1',
    });
    const enqueued = harness.rpcCalls.filter((call) => call.fn === 'enqueue_webhook_outbox');
    expect(enqueued.map((call) => call.args.p_effect_key)).toEqual([
      confirmationEffectKey('sub_1'),
      startedEffectKey('sub_1'),
    ]);
    expect(harness.rpcCalls.some((call) => call.fn === 'complete_stripe_event')).toBe(true);
  });

  it('returns 200 without claiming a processed event', async () => {
    const harness = createHarness({ insertStatus: 'processed' });
    const result = await handleStripeWebhookEvent({
      event: baseEvent('customer.subscription.updated', { id: 'sub_1' }),
      supabase: harness.supabase as never,
      stripe: harness.stripe as never,
    });
    expect(result.httpStatus).toBe(200);
    expect(harness.rpcCalls.map((call) => call.fn)).toEqual(['insert_stripe_event']);
    expect(harness.updates).toHaveLength(0);
  });

  it('does not enqueue an active confirmation for incomplete checkout', async () => {
    const sub = subscription({ status: 'incomplete' });
    const harness = createHarness({ subscriptions: { sub_1: sub } });
    const result = await handleStripeWebhookEvent({
      event: baseEvent('checkout.session.completed', {
        id: 'cs_1',
        subscription: 'sub_1',
        metadata: { userId: USER_ID },
      }),
      supabase: harness.supabase as never,
      stripe: harness.stripe as never,
    });
    expect(result.httpStatus).toBe(200);
    expect(harness.updates[0]).toMatchObject({ subscription_status: 'incomplete' });
    expect(harness.rpcCalls.filter((call) => call.fn === 'enqueue_webhook_outbox')).toHaveLength(0);
  });

  it('enqueues confirmation when a later event becomes active', async () => {
    const sub = subscription({ status: 'active' });
    const harness = createHarness({ subscriptions: { sub_1: sub } });
    await handleStripeWebhookEvent({
      event: baseEvent(
        'invoice.paid',
        {
          id: 'in_1',
          parent: {
            subscription_details: { subscription: 'sub_1', metadata: { userId: USER_ID } },
          },
        },
        'evt_invoice'
      ),
      supabase: harness.supabase as never,
      stripe: harness.stripe as never,
    });
    expect(
      harness.rpcCalls.some(
        (call) =>
          call.fn === 'enqueue_webhook_outbox' &&
          call.args.p_effect_key === confirmationEffectKey('sub_1')
      )
    ).toBe(true);
  });

  it('activates from a subscription event before checkout using metadata.userId', async () => {
    const sub = subscription({ status: 'active' });
    const harness = createHarness({ subscriptions: { sub_1: sub } });
    const result = await handleStripeWebhookEvent({
      event: baseEvent('customer.subscription.updated', sub),
      supabase: harness.supabase as never,
      stripe: harness.stripe as never,
    });
    expect(result.httpStatus).toBe(200);
    expect(harness.updates[0]).toMatchObject({ subscription_status: 'active' });
  });

  it('fails a zero-row profile update', async () => {
    const sub = subscription({ status: 'active' });
    const harness = createHarness({
      subscriptions: { sub_1: sub },
      updateRows: [],
    });
    await expect(
      handleStripeWebhookEvent({
        event: baseEvent('customer.subscription.updated', sub),
        supabase: harness.supabase as never,
        stripe: harness.stripe as never,
      })
    ).rejects.toThrow(/affected 0 rows/);
    expect(harness.rpcCalls.some((call) => call.fn === 'fail_stripe_event')).toBe(true);
  });

  it('ignores a canceled event for a superseded subscription', async () => {
    const oldSub = subscription({ id: 'sub_old', status: 'canceled' });
    const harness = createHarness({
      subscriptions: { sub_old: oldSub },
      profiles: [
        {
          id: USER_ID,
          email: 'member@example.com',
          stripe_customer_id: 'cus_1',
          stripe_subscription_id: 'sub_new',
        },
      ],
    });
    const result = await handleStripeWebhookEvent({
      event: baseEvent('customer.subscription.deleted', oldSub),
      supabase: harness.supabase as never,
      stripe: harness.stripe as never,
    });
    expect(result.httpStatus).toBe(200);
    expect(harness.updates).toHaveLength(0);
    expect(
      harness.rpcCalls.some(
        (call) => call.args.p_effect_key === canceledEffectKey('sub_old')
      )
    ).toBe(false);
  });

  it('leaves the profile unchanged when Stripe status is unknown', async () => {
    const sub = subscription({ status: 'not_a_real_status' });
    const harness = createHarness({ subscriptions: { sub_1: sub } });
    await expect(
      handleStripeWebhookEvent({
        event: baseEvent('customer.subscription.updated', sub),
        supabase: harness.supabase as never,
        stripe: harness.stripe as never,
      })
    ).rejects.toThrow(/not_a_real_status/);
    expect(harness.updates).toHaveLength(0);
    expect(harness.rpcCalls.some((call) => call.fn === 'fail_stripe_event')).toBe(true);
  });

  it('uses the same effect_key for two Stripe event ids of one activation', async () => {
    const sub = subscription({ status: 'active' });
    const harness = createHarness({ subscriptions: { sub_1: sub } });
    await handleStripeWebhookEvent({
      event: baseEvent('checkout.session.completed', {
        id: 'cs_1',
        subscription: 'sub_1',
        metadata: { userId: USER_ID },
      }, 'evt_a'),
      supabase: harness.supabase as never,
      stripe: harness.stripe as never,
    });
    await handleStripeWebhookEvent({
      event: baseEvent(
        'invoice.paid',
        {
          id: 'in_1',
          parent: { subscription_details: { subscription: 'sub_1', metadata: {} } },
        },
        'evt_b'
      ),
      supabase: harness.supabase as never,
      stripe: harness.stripe as never,
    });
    const keys = harness.rpcCalls
      .filter((call) => call.fn === 'enqueue_webhook_outbox')
      .map((call) => call.args.p_effect_key);
    expect(keys.filter((key) => key === confirmationEffectKey('sub_1'))).toHaveLength(2);
  });
});
