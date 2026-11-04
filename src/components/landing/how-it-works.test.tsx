import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HowItWorks } from '@/components/landing/how-it-works';
import { CURATED_ADVENTURES_PER_MONTH } from '@/lib/home/hero';
import { REDEMPTION_CODE_LIFETIME_LABEL } from '@/lib/redemption-expiry';

describe('HowItWorks', () => {
  afterEach(() => {
    cleanup();
  });

  it('describes the product that exists and does not name a Stamps page or an unbuilt perk', () => {
    render(<HowItWorks />);
    const section = screen.getByRole('region', { name: 'How it works' });
    const text = section.textContent ?? '';
    expect(text).toContain('Tell us your tastes');
    expect(text).toContain(`${CURATED_ADVENTURES_PER_MONTH} curated restaurant adventures`);
    expect(text).toContain(`Codes expire ${REDEMPTION_CODE_LIFETIME_LABEL}`);
    expect(text).toContain('Passport');
    expect(text).not.toMatch(/\bStamps\b/);
    expect(text).not.toMatch(/Level Up|waitlist|Subscribe|unlimited|\$\d+|badge|checkout/i);
  });
});
