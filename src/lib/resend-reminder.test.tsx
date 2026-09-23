import { describe, expect, it } from 'vitest';
import { buildRedemptionReminderEmail, buildSubscriptionConfirmationEmail } from '@/lib/resend';

describe('reminder message', () => {
  it('puts the unsubscribe link in HTML, plain text, and the one-click headers', async () => {
    const url = 'https://wanderbite.test/email/unsubscribe?token=abc';
    const message = await buildRedemptionReminderEmail({
      to: 'member@example.com',
      restaurantNames: ['Ada'],
      daysLeft: 6,
      unsubscribeUrl: url,
    });
    expect(message.html).toContain(url);
    expect(message.html).toContain('Unsubscribe from adventure reminders');
    expect(message.text).toContain(url);
    expect(message.text).toContain('into the void');
    expect(message.headers['List-Unsubscribe']).toBe(`<${url}>`);
    expect(message.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('does not put an unsubscribe control on the confirmation receipt', async () => {
    const message = await buildSubscriptionConfirmationEmail('member@example.com');
    expect(message.html.toLowerCase()).not.toContain('unsubscribe');
    expect(message.headers['List-Unsubscribe']).toBeUndefined();
    expect(message.headers['List-Unsubscribe-Post']).toBeUndefined();
  });
});
