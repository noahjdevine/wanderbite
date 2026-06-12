/**
 * Transactional email via Resend.
 * Required: RESEND_API_KEY (add in Vercel dashboard for production).
 * From address uses wanderbite.com; verify the domain in Resend.
 */
import { render, toPlainText } from '@react-email/components';
import { Resend } from 'resend';
import { RedemptionReminderEmail } from '@/emails/redemption-reminder';
import { SubscriptionConfirmationEmail } from '@/emails/subscription-confirmation';

const resendApiKey = process.env.RESEND_API_KEY;
const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
  'https://wanderbite.co';

const FROM = 'Wanderbite <noreply@wanderbite.com>';

/**
 * Sends the post-checkout subscription confirmation email.
 * No-op if RESEND_API_KEY is not set (logs and returns).
 */
export async function sendSubscriptionConfirmationEmail(to: string): Promise<void> {
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not set; skipping subscription confirmation email');
    return;
  }

  const resend = new Resend(resendApiKey);

  try {
    const html = await render(
      <SubscriptionConfirmationEmail baseUrl={baseUrl} />
    );
    const text = toPlainText(html);

    await resend.emails.send({
      from: FROM,
      to: [to],
      subject: 'Your Wanderbite subscription is active',
      html,
      text,
    });
  } catch (err) {
    console.error('Failed to send subscription confirmation email:', err);
    // Do not throw — webhook should still return 200 so Stripe doesn't retry
  }
}

/**
 * Sends the end-of-month redemption reminder email.
 * Called from the end-of-month-reminder cron for users with unredeemed picks.
 * No-op if RESEND_API_KEY is not set (logs and returns).
 */
export async function sendRedemptionReminderEmail(
  to: string,
  restaurantNames: string[],
  daysLeft: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not set; skipping redemption reminder email');
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }

  if (restaurantNames.length === 0) {
    return { ok: false, error: 'No restaurants to remind about' };
  }

  const resend = new Resend(resendApiKey);

  try {
    const html = await render(
      <RedemptionReminderEmail
        baseUrl={baseUrl}
        restaurantNames={restaurantNames}
        daysLeft={daysLeft}
      />
    );
    const text = toPlainText(html);

    const subject =
      daysLeft === 1
        ? '1 day left to redeem your Wanderbite picks'
        : `${daysLeft} days left to redeem your Wanderbite picks`;

    await resend.emails.send({
      from: FROM,
      to: [to],
      subject,
      html,
      text,
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Failed to send redemption reminder email:', err);
    return { ok: false, error: message };
  }
}
