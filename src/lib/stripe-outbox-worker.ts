import type Stripe from 'stripe';
import { captureEvent } from '@/lib/posthog-server';
import { sendSubscriptionConfirmationEmail } from '@/lib/resend';
import {
  applyVerifiedStripeEvent,
  type StripeAdminClient,
} from '@/lib/stripe-webhook';
import type { Json } from '@/types/database.types';

const EVENT_BATCH = 25;
const OUTBOX_BATCH = 25;

type OutboxRow = {
  effect_key: string;
  effect_type: string;
  attempts: number;
  payload: Json;
};

type OutboxPayload = {
  userId?: unknown;
  to?: unknown;
  subscriptionId?: unknown;
  customerId?: unknown;
};

function payloadOf(row: OutboxRow): OutboxPayload {
  return row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? (row.payload as OutboxPayload)
    : {};
}

async function rpcBoolean(
  supabase: StripeAdminClient,
  fn:
    | 'complete_webhook_outbox'
    | 'fail_webhook_outbox'
    | 'complete_stripe_event'
    | 'fail_stripe_event'
    | 'purge_stripe_event_payloads',
  args: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function resolveEmail(
  supabase: StripeAdminClient,
  payload: OutboxPayload
): Promise<string | null> {
  if (typeof payload.to === 'string' && payload.to.includes('@')) {
    return payload.to;
  }
  if (typeof payload.userId !== 'string') return null;
  const { data, error } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('id', payload.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const email = (data as { email: string | null } | null)?.email ?? null;
  return email && email.includes('@') ? email : null;
}

async function deliverOutboxRow(
  supabase: StripeAdminClient,
  row: OutboxRow,
  claimToken: string
): Promise<void> {
  const payload = payloadOf(row);

  try {
    if (row.effect_type === 'subscription_confirmation_email') {
      const to = await resolveEmail(supabase, payload);
      if (!to) {
        throw new Error('No recipient email for confirmation');
      }
      const sent = await sendSubscriptionConfirmationEmail(to, row.effect_key);
      if (!sent.ok) {
        throw new Error(sent.error);
      }
    } else if (
      row.effect_type === 'subscription_started' ||
      row.effect_type === 'subscription_canceled'
    ) {
      const userId = typeof payload.userId === 'string' ? payload.userId : null;
      if (!userId) {
        throw new Error('No userId for analytics effect');
      }
      if (!process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim()) {
        await rpcBoolean(supabase, 'complete_webhook_outbox', {
          p_effect_key: row.effect_key,
          p_token: claimToken,
        });
        return;
      }
      await captureEvent(userId, row.effect_type, {
        stripe_customer_id:
          typeof payload.customerId === 'string' ? payload.customerId : null,
        stripe_subscription_id:
          typeof payload.subscriptionId === 'string' ? payload.subscriptionId : null,
      });
    } else {
      throw new Error(`Unknown effect_type ${row.effect_type}`);
    }

    const completed = await rpcBoolean(supabase, 'complete_webhook_outbox', {
      p_effect_key: row.effect_key,
      p_token: claimToken,
    });
    if (!completed) {
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Outbox delivery failed';
    await rpcBoolean(supabase, 'fail_webhook_outbox', {
      p_effect_key: row.effect_key,
      p_token: claimToken,
      p_error: message,
    }).catch(() => false);
    throw err;
  }
}

export async function processWebhookOutbox(params: {
  supabase: StripeAdminClient;
  stripe: Stripe;
  eventLimit?: number;
  outboxLimit?: number;
}): Promise<{ eventsClaimed: number; outboxClaimed: number; eventErrors: number; outboxErrors: number }> {
  const eventLimit = params.eventLimit ?? EVENT_BATCH;
  const outboxLimit = params.outboxLimit ?? OUTBOX_BATCH;
  let eventErrors = 0;
  let outboxErrors = 0;

  const eventToken = crypto.randomUUID();
  const { data: eventRows, error: eventError } = await params.supabase.rpc(
    'claim_stripe_events_batch',
    { p_limit: eventLimit, p_token: eventToken }
  );
  if (eventError) {
    throw new Error(eventError.message);
  }
  const claimedEvents = eventRows ?? [];

  for (const row of claimedEvents) {
    try {
      const event = row.payload as unknown as Stripe.Event;
      await applyVerifiedStripeEvent({
        event,
        supabase: params.supabase,
        stripe: params.stripe,
      });
      const completed = await rpcBoolean(params.supabase, 'complete_stripe_event', {
        p_event_id: row.event_id,
        p_token: eventToken,
      });
      if (!completed) {
        eventErrors += 1;
      }
    } catch (err) {
      eventErrors += 1;
      const message = err instanceof Error ? err.message : 'Event replay failed';
      await rpcBoolean(params.supabase, 'fail_stripe_event', {
        p_event_id: row.event_id,
        p_token: eventToken,
        p_error: message,
      }).catch(() => false);
    }
  }

  const outboxToken = crypto.randomUUID();
  const { data: outboxRows, error: outboxError } = await params.supabase.rpc(
    'claim_webhook_outbox_batch',
    { p_limit: outboxLimit, p_token: outboxToken }
  );
  if (outboxError) {
    throw new Error(outboxError.message);
  }
  const claimedOutbox = (outboxRows ?? []) as OutboxRow[];

  for (const row of claimedOutbox) {
    try {
      await deliverOutboxRow(params.supabase, row, outboxToken);
    } catch {
      outboxErrors += 1;
    }
  }

  await params.supabase.rpc('purge_stripe_event_payloads');

  return {
    eventsClaimed: claimedEvents.length,
    outboxClaimed: claimedOutbox.length,
    eventErrors,
    outboxErrors,
  };
}
