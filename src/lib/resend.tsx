/**
 * Transactional email via Resend.
 * Required: RESEND_API_KEY (add in Vercel dashboard for production).
 * From address uses wanderbite.com; verify the domain in Resend.
 */
import { render, toPlainText } from '@react-email/components';
import { Resend } from 'resend';
import { RedemptionReminderEmail } from '@/emails/redemption-reminder';
import { SubscriptionConfirmationEmail } from '@/emails/subscription-confirmation';
import {
  EMAIL_FROM,
  classifyResendSend,
  type EmailSendOutcome,
  type StoredEmailPayload,
} from '@/lib/email-send';

export function emailBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    'https://wanderbite.co'
  );
}

export function reminderSubject(daysLeft: number): string {
  return daysLeft === 1
    ? '1 day left to redeem your Wanderbite picks'
    : `${daysLeft} days left to redeem your Wanderbite picks`;
}

export async function buildSubscriptionConfirmationEmail(
  to: string,
): Promise<StoredEmailPayload> {
  const html = await render(
    <SubscriptionConfirmationEmail baseUrl={emailBaseUrl()} />,
  );
  const text = toPlainText(html);
  return {
    from: EMAIL_FROM,
    to,
    subject: 'Your Wanderbite subscription is active',
    html,
    text,
    headers: {},
  };
}

export async function buildRedemptionReminderEmail(input: {
  to: string;
  restaurantNames: string[];
  daysLeft: number;
  unsubscribeUrl: string;
}): Promise<StoredEmailPayload> {
  const html = await render(
    <RedemptionReminderEmail
      baseUrl={emailBaseUrl()}
      restaurantNames={input.restaurantNames}
      daysLeft={input.daysLeft}
      unsubscribeUrl={input.unsubscribeUrl}
    />,
  );
  let text = toPlainText(html);
  if (!text.includes(input.unsubscribeUrl)) {
    text = `${text}\n\nUnsubscribe from adventure reminders: ${input.unsubscribeUrl}`;
  }
  return {
    from: EMAIL_FROM,
    to: input.to,
    subject: reminderSubject(input.daysLeft),
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${input.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/**
 * Sends a previously stored payload. The idempotency key must be the same key
 * used for that payload. A Resend `{ error }` or missing `data` is not success.
 */
export async function sendStoredEmail(
  payload: StoredEmailPayload,
  idempotencyKey: string,
): Promise<EmailSendOutcome> {
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (!resendApiKey) {
    return { outcome: 'definite_failure', error: 'RESEND_API_KEY not configured' };
  }

  const resend = new Resend(resendApiKey);
  const headers = Object.keys(payload.headers).length > 0 ? payload.headers : undefined;

  try {
    const { data, error } = await resend.emails.send(
      {
        from: payload.from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        headers,
      },
      { idempotencyKey },
    );

    if (error || !data) {
      return classifyResendSend({ data, error });
    }

    return classifyResendSend({ data, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { outcome: 'uncertain', error: message };
  }
}
