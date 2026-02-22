/**
 * Transactional email via Resend.
 * Required: RESEND_API_KEY (add in Vercel dashboard for production).
 * From address uses wanderbite.com; verify the domain in Resend.
 */
import { Resend } from 'resend';

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

  const html = `
<p>Thanks for subscribing to Wanderbite! Your plan is $15/month, billed monthly and auto-renewing until canceled. Your plan includes 2 challenges per month and 1 swap per month (reset monthly).</p>
<p>Cancel anytime in Settings → Manage Subscription. Cancellation takes effect at the end of your current billing period. No partial refunds.</p>
<p>Discount rules: Unless otherwise stated, challenges include $10 off $40+ before tax/tip, are not stackable, and require in-person confirmation at the restaurant.</p>
<p>
  <a href="${baseUrl}/terms">Terms</a> · 
  <a href="${baseUrl}/privacy">Privacy</a> · 
  <a href="${baseUrl}/terms">Rules</a> · 
  Support: <a href="mailto:support@wanderbite.com">support@wanderbite.com</a>
</p>
`.trim();

  const text = `Thanks for subscribing to Wanderbite! Your plan is $15/month, billed monthly and auto-renewing until canceled. Your plan includes 2 challenges per month and 1 swap per month (reset monthly).

Cancel anytime in Settings → Manage Subscription. Cancellation takes effect at the end of your current billing period. No partial refunds.

Discount rules: Unless otherwise stated, challenges include $10 off $40+ before tax/tip, are not stackable, and require in-person confirmation at the restaurant.

Terms: ${baseUrl}/terms
Privacy: ${baseUrl}/privacy
Rules: ${baseUrl}/terms
Support: support@wanderbite.com`;

  try {
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
