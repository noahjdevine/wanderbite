import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import type { Database, Json } from '@/types/database.types';
import { stripeInvoiceSubscriptionId } from '@/lib/stripe-invoice';
import {
  stripePeriodEndIso,
  stripeSubscriptionStatusToProfileStatus,
  type ProfileSubscriptionStatus,
} from '@/lib/stripe-subscription';

const USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUBSCRIPTION_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]);

export type StripeAdminClient = SupabaseClient<Database>;

export class RetryableStripeWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableStripeWebhookError';
  }
}

type ProfileRow = {
  id: string;
  email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

type OutboxPayload = {
  userId: string;
  to: string | null;
  subscriptionId: string;
  customerId: string | null;
};

export function parseUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return USER_ID_RE.test(trimmed) ? trimmed : null;
}

export function confirmationEffectKey(subscriptionId: string): string {
  return `subscription-confirmation/${subscriptionId}`;
}

export function startedEffectKey(subscriptionId: string): string {
  return `subscription-started/${subscriptionId}`;
}

export function canceledEffectKey(subscriptionId: string): string {
  return `subscription-canceled/${subscriptionId}`;
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function objectId(event: Stripe.Event): string | null {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === 'string' ? object.id : null;
}

function customerIdFrom(
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id ?? null;
}

function checkoutSubscriptionId(session: Stripe.Checkout.Session): string | null {
  const sub = session.subscription;
  if (!sub) return null;
  return typeof sub === 'string' ? sub : sub.id;
}

function checkoutEmail(session: Stripe.Checkout.Session): string | null {
  return session.customer_email ?? session.customer_details?.email ?? null;
}

async function rpcBoolean(
  supabase: StripeAdminClient,
  fn: keyof Database['public']['Functions'],
  args: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) {
    throw new RetryableStripeWebhookError(error.message);
  }
  return Boolean(data);
}

export async function insertStripeEvent(
  supabase: StripeAdminClient,
  event: Stripe.Event
): Promise<Database['public']['Tables']['stripe_events']['Row']> {
  const { data, error } = await supabase.rpc('insert_stripe_event', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_object_id: objectId(event),
    p_livemode: event.livemode,
    p_api_version: event.api_version,
    p_stripe_created: new Date(event.created * 1000).toISOString(),
    p_payload: asJson(event),
  });
  if (error || !data) {
    throw new RetryableStripeWebhookError(error?.message ?? 'Failed to insert stripe event');
  }
  return data;
}

async function enqueueEffect(
  supabase: StripeAdminClient,
  params: {
    effectKey: string;
    effectType:
      | 'subscription_confirmation_email'
      | 'subscription_started'
      | 'subscription_canceled';
    sourceEventId: string;
    payload: OutboxPayload;
  }
): Promise<void> {
  const { error } = await supabase.rpc('enqueue_webhook_outbox', {
    p_effect_key: params.effectKey,
    p_effect_type: params.effectType,
    p_source_event_id: params.sourceEventId,
    p_payload: asJson(params.payload),
  });
  if (error) {
    throw new RetryableStripeWebhookError(error.message);
  }
}

async function loadProfileById(
  supabase: StripeAdminClient,
  userId: string
): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, email, stripe_customer_id, stripe_subscription_id')
    .eq('id', userId);

  if (error) {
    throw new RetryableStripeWebhookError(error.message);
  }
  const rows = (data ?? []) as ProfileRow[];
  if (rows.length !== 1) {
    throw new RetryableStripeWebhookError(
      `Expected one profile for user ${userId}, got ${rows.length}`
    );
  }
  return rows[0]!;
}

async function loadProfileByCustomerId(
  supabase: StripeAdminClient,
  customerId: string
): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, email, stripe_customer_id, stripe_subscription_id')
    .eq('stripe_customer_id', customerId);

  if (error) {
    throw new RetryableStripeWebhookError(error.message);
  }
  const rows = (data ?? []) as ProfileRow[];
  if (rows.length !== 1) {
    throw new RetryableStripeWebhookError(
      `Expected one profile for customer ${customerId}, got ${rows.length}`
    );
  }
  return rows[0]!;
}

async function resolveProfile(
  supabase: StripeAdminClient,
  params: {
    metadataUserId: string | null;
    customerId: string | null;
  }
): Promise<ProfileRow> {
  if (params.metadataUserId) {
    return loadProfileById(supabase, params.metadataUserId);
  }
  if (params.customerId) {
    return loadProfileByCustomerId(supabase, params.customerId);
  }
  throw new RetryableStripeWebhookError('Unable to resolve user for Stripe event');
}

async function shouldIgnoreSupersededSubscription(
  stripe: Stripe,
  profile: ProfileRow,
  subscription: Stripe.Subscription,
  mapped: ProfileSubscriptionStatus
): Promise<boolean> {
  if (!profile.stripe_subscription_id || profile.stripe_subscription_id === subscription.id) {
    return false;
  }
  if (mapped === 'canceled') {
    return true;
  }
  try {
    const stored = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
    const storedMapped = stripeSubscriptionStatusToProfileStatus(stored.status);
    return storedMapped !== 'canceled';
  } catch {
    return false;
  }
}

async function applySubscriptionState(params: {
  supabase: StripeAdminClient;
  stripe: Stripe;
  sourceEventId: string;
  subscription: Stripe.Subscription;
  metadataUserId: string | null;
  email: string | null;
}): Promise<void> {
  const mapped = stripeSubscriptionStatusToProfileStatus(params.subscription.status);
  const customerId = customerIdFrom(params.subscription.customer);
  const profile = await resolveProfile(params.supabase, {
    metadataUserId: params.metadataUserId,
    customerId,
  });

  if (
    await shouldIgnoreSupersededSubscription(
      params.stripe,
      profile,
      params.subscription,
      mapped
    )
  ) {
    return;
  }

  const { data, error } = await params.supabase
    .from('user_profiles')
    .update({
      stripe_customer_id: customerId,
      stripe_subscription_id: params.subscription.id,
      subscription_status: mapped,
      current_period_end: stripePeriodEndIso(params.subscription),
    })
    .eq('id', profile.id)
    .select('id');

  if (error) {
    throw new RetryableStripeWebhookError(error.message);
  }
  if (!data || data.length !== 1) {
    throw new RetryableStripeWebhookError(
      `Profile update affected ${data?.length ?? 0} rows`
    );
  }

  const payload: OutboxPayload = {
    userId: profile.id,
    to: params.email ?? profile.email,
    subscriptionId: params.subscription.id,
    customerId,
  };

  if (mapped === 'active') {
    await enqueueEffect(params.supabase, {
      effectKey: confirmationEffectKey(params.subscription.id),
      effectType: 'subscription_confirmation_email',
      sourceEventId: params.sourceEventId,
      payload,
    });
    await enqueueEffect(params.supabase, {
      effectKey: startedEffectKey(params.subscription.id),
      effectType: 'subscription_started',
      sourceEventId: params.sourceEventId,
      payload,
    });
  }

  if (mapped === 'canceled') {
    await enqueueEffect(params.supabase, {
      effectKey: canceledEffectKey(params.subscription.id),
      effectType: 'subscription_canceled',
      sourceEventId: params.sourceEventId,
      payload,
    });
  }
}

export async function applyVerifiedStripeEvent(params: {
  event: Stripe.Event;
  supabase: StripeAdminClient;
  stripe: Stripe;
}): Promise<void> {
  if (!SUBSCRIPTION_EVENT_TYPES.has(params.event.type)) {
    return;
  }

  let subscriptionId: string | null = null;
  let metadataUserId: string | null = null;
  let email: string | null = null;

  switch (params.event.type) {
    case 'checkout.session.completed': {
      const session = params.event.data.object as Stripe.Checkout.Session;
      subscriptionId = checkoutSubscriptionId(session);
      metadataUserId =
        parseUserId(session.metadata?.userId) ?? parseUserId(session.client_reference_id);
      email = checkoutEmail(session);
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = params.event.data.object as Stripe.Subscription;
      subscriptionId = subscription.id;
      metadataUserId = parseUserId(subscription.metadata?.userId);
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = params.event.data.object as Stripe.Invoice;
      subscriptionId = stripeInvoiceSubscriptionId(invoice);
      metadataUserId = parseUserId(
        invoice.parent?.subscription_details?.metadata?.userId
      );
      email = invoice.customer_email ?? null;
      break;
    }
    default:
      return;
  }

  if (!subscriptionId) {
    throw new RetryableStripeWebhookError(
      `${params.event.type}: missing subscription id`
    );
  }

  const subscription = await params.stripe.subscriptions.retrieve(subscriptionId);
  if (!metadataUserId) {
    metadataUserId = parseUserId(subscription.metadata?.userId);
  }

  await applySubscriptionState({
    supabase: params.supabase,
    stripe: params.stripe,
    sourceEventId: params.event.id,
    subscription,
    metadataUserId,
    email,
  });
}

export async function handleStripeWebhookEvent(params: {
  event: Stripe.Event;
  supabase: StripeAdminClient;
  stripe: Stripe;
}): Promise<{ httpStatus: number; body: { received: true } | { error: string } }> {
  const row = await insertStripeEvent(params.supabase, params.event);
  if (row.status === 'processed') {
    return { httpStatus: 200, body: { received: true } };
  }

  const claimToken = randomUUID();
  const claimed = await rpcBoolean(params.supabase, 'claim_stripe_event', {
    p_event_id: params.event.id,
    p_token: claimToken,
  });
  if (!claimed) {
    return { httpStatus: 500, body: { error: 'Stripe event could not be claimed' } };
  }

  try {
    await applyVerifiedStripeEvent(params);
    const completed = await rpcBoolean(params.supabase, 'complete_stripe_event', {
      p_event_id: params.event.id,
      p_token: claimToken,
    });
    if (!completed) {
      return { httpStatus: 500, body: { error: 'Stripe event claim was stolen' } };
    }
    return { httpStatus: 200, body: { received: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handler failed';
    await rpcBoolean(params.supabase, 'fail_stripe_event', {
      p_event_id: params.event.id,
      p_token: claimToken,
      p_error: message,
    }).catch(() => false);
    throw err;
  }
}
