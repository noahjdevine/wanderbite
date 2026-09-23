import 'server-only';

import { Resend, type WebhookEventPayload } from 'resend';
import { oneMailbox } from '@/lib/email-address';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

type Admin = SupabaseClient<Database>;

export type ResendWebhookResult = {
  status: number;
  body: { received: true } | { error: string };
};

function verifyEvent(payload: string, request: Request, secret: string): WebhookEventPayload {
  const resend = new Resend(process.env.RESEND_API_KEY?.trim() || 're_webhook_verify_only');
  return resend.webhooks.verify({
    payload,
    headers: {
      id: request.headers.get('svix-id') ?? '',
      timestamp: request.headers.get('svix-timestamp') ?? '',
      signature: request.headers.get('svix-signature') ?? '',
    },
    webhookSecret: secret,
  });
}

function suppressionFrom(event: WebhookEventPayload): {
  eventType: 'email.bounced' | 'email.complained' | 'email.suppressed';
  emailId: string;
  to: string[];
  reason: string;
} | null {
  if (event.type === 'email.bounced') {
    if (event.data.bounce.type !== 'Permanent') return null;
    return {
      eventType: event.type,
      emailId: event.data.email_id,
      to: event.data.to,
      reason: 'permanent_bounce',
    };
  }
  if (event.type === 'email.complained') {
    return {
      eventType: event.type,
      emailId: event.data.email_id,
      to: event.data.to,
      reason: 'complaint',
    };
  }
  if (event.type === 'email.suppressed') {
    return {
      eventType: event.type,
      emailId: event.data.email_id,
      to: event.data.to,
      reason: 'provider_suppressed',
    };
  }
  return null;
}

export async function handleResendWebhook(params: {
  request: Request;
  supabase: Admin;
  secret?: string;
}): Promise<ResendWebhookResult> {
  const secret = (params.secret ?? process.env.RESEND_WEBHOOK_SECRET)?.trim();
  if (!secret) {
    return { status: 400, body: { error: 'Webhook secret not configured' } };
  }

  const payload = await params.request.text();
  let event: WebhookEventPayload;
  try {
    event = verifyEvent(payload, params.request, secret);
  } catch {
    return { status: 400, body: { error: 'Invalid webhook signature' } };
  }

  const suppression = suppressionFrom(event);
  if (!suppression) {
    return { status: 200, body: { received: true } };
  }

  const address = oneMailbox(suppression.to);
  if (!address || !suppression.emailId.trim()) {
    return { status: 400, body: { error: 'Invalid recipient' } };
  }

  const deliveryId = params.request.headers.get('svix-id')?.trim();
  if (!deliveryId) {
    return { status: 400, body: { error: 'Invalid webhook signature' } };
  }

  const { data, error } = await params.supabase.rpc('apply_resend_webhook_suppression', {
    p_delivery_id: deliveryId,
    p_event_type: suppression.eventType,
    p_email_id: suppression.emailId,
    p_address: address,
    p_reason: suppression.reason,
  });
  if (error || (data !== 'applied' && data !== 'duplicate')) {
    return { status: 500, body: { error: 'Suppression was not saved' } };
  }
  return { status: 200, body: { received: true } };
}
