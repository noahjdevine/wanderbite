import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyRedemptionTokenForPartner = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/app/actions/partner-auth', () => ({
  logoutPartner: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/app/actions/partner-verify', () => ({
  verifyRedemptionTokenForPartner: (...args: unknown[]) => verifyRedemptionTokenForPartner(...args),
}));

import { PartnerRedeemClient } from './partner-redeem-client';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

beforeEach(() => {
  verifyRedemptionTokenForPartner.mockReset();
  refresh.mockReset();
});

describe('PartnerRedeemClient', () => {
  it('has one h1, the same code field, and one verify call', async () => {
    verifyRedemptionTokenForPartner.mockResolvedValue({
      success: false,
      message: 'Invalid code',
    });
    render(<PartnerRedeemClient restaurantName="North Grill" slug="north-grill" />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'North Grill' })).toBeTruthy();
    expect(screen.getByText('Redeem mode')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Full dashboard' }).getAttribute('href')).toBe(
      '/partner/north-grill',
    );

    const input = screen.getByLabelText('Customer code');
    expect(input.getAttribute('id')).toBe('partner-redeem-code');
    expect(input.getAttribute('name')).toBeNull();
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('inputmode')).toBeNull();
    expect(input.getAttribute('placeholder')).toBe('WB-XXXXX');
    expect(input.getAttribute('spellcheck')).toBe('false');

    fireEvent.change(input, { target: { value: 'wb-abcde' } });
    expect((input as HTMLInputElement).value).toBe('WB-ABCDE');
    const form = input.closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(verifyRedemptionTokenForPartner).toHaveBeenCalledTimes(1);
    });
    expect(verifyRedemptionTokenForPartner).toHaveBeenCalledWith('WB-ABCDE');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Invalid code');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(input.getAttribute('aria-describedby')).toBe('partner-redeem-error');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows the same verified copy', async () => {
    verifyRedemptionTokenForPartner.mockResolvedValue({
      success: true,
      redemptionDetails: {
        email: 'guest@example.com',
        restaurantName: 'North Grill',
        verifiedAt: 'Nov 4, 2026, 3:00 PM',
      },
      newBadgesEarned: [],
      hideDiscountAmount: false,
      sealedDiscountCents: null,
      sealedMinSpendCents: null,
    });
    render(<PartnerRedeemClient restaurantName="North Grill" slug="north-grill" />);
    const input = screen.getByLabelText('Customer code');
    fireEvent.change(input, { target: { value: 'WB-OK' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Verified');
    expect(status.textContent).toContain("Apply the Wanderbite discount on the guest's check.");
    expect(status.textContent).toContain('Guest: guest@example.com');
    expect(status.textContent).toContain('Nov 4, 2026, 3:00 PM');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Redeem another code' })).toBeTruthy();
  });

  it('still auto-verifies a pending code once', async () => {
    verifyRedemptionTokenForPartner.mockResolvedValue({
      success: false,
      message: 'This code was already used on Nov 1, 2026.',
    });
    render(
      <PartnerRedeemClient restaurantName="North Grill" slug="north-grill" initialCode="wb-auto" />,
    );
    await waitFor(() => {
      expect(verifyRedemptionTokenForPartner).toHaveBeenCalledTimes(1);
    });
    expect(verifyRedemptionTokenForPartner).toHaveBeenCalledWith('WB-AUTO');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'This code was already used on Nov 1, 2026.',
    );
  });
});
