/**
 * Transactional email via Resend.
 * Required: RESEND_API_KEY (add in Vercel dashboard for production).
 * From address uses wanderbite.com; verify the domain in Resend.
 */
import { render, toPlainText } from '@react-email/components';
import { Resend } from 'resend';
import { SubscriptionConfirmationEmail } from '@/emails/subscription-confirmation';

const resendApiKey = process.env.RESEND_API_KEY;
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://wanderbite.com';

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
