import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyRedemptionTokenForPartner = vi.hoisted(() => vi.fn());
const confirmPartnerBillSubtotal = vi.hoisted(() => vi.fn());
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

vi.mock('@/app/actions/partner-bill-scan', () => ({
  confirmPartnerBillSubtotal: (...args: unknown[]) => confirmPartnerBillSubtotal(...args),
}));

import { PARTNER_CODE_HINT, PARTNER_CODE_NOT_FOUND_MESSAGE } from '@/lib/partner-redemption-code';
import { PartnerRedeemClient } from './partner-redeem-client';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

beforeEach(() => {
  verifyRedemptionTokenForPartner.mockReset();
  confirmPartnerBillSubtotal.mockReset();
  refresh.mockReset();
});

function typeKeys(input: HTMLInputElement, text: string) {
  for (const char of text) {
    fireEvent.change(input, { target: { value: `${input.value}${char}` } });
  }
}

describe('PartnerRedeemClient', () => {
  it('has one h1, the same code field, and one verify call', async () => {
    verifyRedemptionTokenForPartner.mockResolvedValue({
      success: false,
      message: PARTNER_CODE_NOT_FOUND_MESSAGE,
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
    expect(screen.getByRole('button', { name: 'Check code' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify code' })).toBeNull();
    expect(screen.getByText(PARTNER_CODE_HINT)).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe('partner-redeem-hint');
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
    expect(alert.textContent).toContain(PARTNER_CODE_NOT_FOUND_MESSAGE);
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(input.getAttribute('aria-describedby')).toBe('partner-redeem-hint partner-redeem-error');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it.each([
    ['WBABCDE', 'WB-ABCDE'],
    ['WB-ABCDE', 'WB-ABCDE'],
    ['ABCDE', 'WB-ABCDE'],
    ['WB3K7', 'WB-WB3K7'],
  ] as const)('submits %s typed key by key as %s', async (typed, submitted) => {
    verifyRedemptionTokenForPartner.mockResolvedValue({
      success: false,
      message: PARTNER_CODE_NOT_FOUND_MESSAGE,
    });
    render(<PartnerRedeemClient restaurantName="North Grill" slug="north-grill" />);
    const input = screen.getByLabelText('Customer code') as HTMLInputElement;
    typeKeys(input, typed);
    expect(input.value).toBe(typed);
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    await waitFor(() => {
      expect(verifyRedemptionTokenForPartner).toHaveBeenCalledWith(submitted);
    });
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
    expect(status.textContent).not.toContain('$0');
    expect(status.querySelector('[data-confirmed-discount]')).toBeNull();
  });

  it('shows a confirmed quote total and its parts', async () => {
    verifyRedemptionTokenForPartner.mockResolvedValue({
      success: true,
      redemptionDetails: {
        email: 'guest@example.com',
        restaurantName: 'North Grill',
        verifiedAt: 'Nov 4, 2026, 3:00 PM',
      },
      newBadgesEarned: [],
      hideDiscountAmount: false,
      sealedDiscountCents: 1500,
      sealedMinSpendCents: 4000,
      confirmedTotalDiscountCents: 2500,
      confirmedBaseDiscountCents: 2000,
      confirmedBoostDiscountCents: 500,
      needsSubtotal: false,
    });
    render(<PartnerRedeemClient restaurantName="North Grill" slug="north-grill" />);
    fireEvent.change(screen.getByLabelText('Customer code'), { target: { value: 'WB-OK' } });
    fireEvent.submit(screen.getByLabelText('Customer code').closest('form') as HTMLFormElement);
    const status = await screen.findByRole('status');
    const totals = status.querySelector('[data-confirmed-discount]')?.textContent ?? '';
    expect(totals).toContain('Discount $20');
    expect(totals).toContain('Boost $5');
    expect(totals).toContain('Wanderbite covers $25');
    expect(status.textContent).toContain("Apply the Wanderbite discount on the guest's check.");
  });

  it('says the bill needs confirm and does not show $0', async () => {
    verifyRedemptionTokenForPartner.mockResolvedValue({
      success: true,
      redemptionDetails: {
        email: null,
        restaurantName: 'North Grill',
        verifiedAt: 'Nov 4, 2026, 3:00 PM',
      },
      newBadgesEarned: [],
      hideDiscountAmount: true,
      sealedDiscountCents: 1500,
      sealedMinSpendCents: 4000,
      confirmedTotalDiscountCents: null,
      confirmedBaseDiscountCents: null,
      confirmedBoostDiscountCents: null,
      needsSubtotal: true,
    });
    render(<PartnerRedeemClient restaurantName="North Grill" slug="north-grill" />);
    fireEvent.change(screen.getByLabelText('Customer code'), { target: { value: 'WB-OK' } });
    fireEvent.submit(screen.getByLabelText('Customer code').closest('form') as HTMLFormElement);
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Bill needs confirm');
    expect(status.textContent).not.toContain('$0');
    expect(status.textContent).not.toContain('$15');
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

  it('confirms a locked Boost bill before verify and then shows the settlement', async () => {
    verifyRedemptionTokenForPartner
      .mockResolvedValueOnce({
        success: false,
        needsBill: true,
        sessionId: '55555555-5555-4555-8555-555555555555',
        minSpendCents: 4000,
        message: 'This guest locked a Boost. Enter the eligible bill subtotal, then verify the code.',
      })
      .mockResolvedValueOnce({
        success: true,
        redemptionDetails: {
          email: 'guest@example.com',
          restaurantName: 'North Grill',
          verifiedAt: 'Nov 4, 2026, 3:00 PM',
        },
        newBadgesEarned: [],
        hideDiscountAmount: false,
        sealedDiscountCents: 1500,
        sealedMinSpendCents: 4000,
        confirmedTotalDiscountCents: 2500,
        confirmedBaseDiscountCents: 2000,
        confirmedBoostDiscountCents: 500,
        needsSubtotal: false,
      });
    confirmPartnerBillSubtotal.mockResolvedValue({
      ok: true,
      quote: {
        baseDiscountCents: 2000,
        boostDiscountCents: 500,
        totalDiscountCents: 2500,
        eligibleSubtotalCents: 8200,
        belowMinimum: false,
      },
    });
    render(<PartnerRedeemClient restaurantName="North Grill" slug="north-grill" />);
    fireEvent.change(screen.getByLabelText('Customer code'), { target: { value: 'WB-BOOST' } });
    fireEvent.submit(screen.getByLabelText('Customer code').closest('form') as HTMLFormElement);
    const held = await screen.findByText(
      'This guest locked a Boost. Enter the eligible bill subtotal, then verify the code.',
    );
    expect(held).toBeTruthy();
    expect(screen.queryByText('Verified')).toBeNull();
    expect(screen.queryByText('Bill needs confirm')).toBeNull();
    expect(verifyRedemptionTokenForPartner).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Confirm bill' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check code' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verify code' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
    const subtotal = screen.getByLabelText('Eligible subtotal') as HTMLInputElement;
    expect(subtotal.getAttribute('placeholder')).toBe('');
    expect(subtotal.value).toBe('');
    expect(screen.getByText('Food and drink before tax and tip.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open arrival check-in' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Eligible subtotal'), { target: { value: '82.00' } });
    fireEvent.submit(screen.getByLabelText('Eligible subtotal').closest('form') as HTMLFormElement);
    expect(await screen.findByText('Wanderbite covers $25')).toBeTruthy();
    expect(screen.getByText('Discount $20')).toBeTruthy();
    expect(screen.getByText('Boost $5')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm bill' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verify code' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Verify' })).toHaveLength(1);
    expect(confirmPartnerBillSubtotal).toHaveBeenCalledWith({
      sessionId: '55555555-5555-4555-8555-555555555555',
      eligibleSubtotalCents: 8200,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    const verified = await screen.findByText('Verified');
    const status = verified.closest('[role="status"]');
    expect(status?.textContent).toContain('Discount $20');
    expect(status?.textContent).toContain('Boost $5');
    expect(status?.textContent).toContain('Wanderbite covers $25');
    expect(verifyRedemptionTokenForPartner).toHaveBeenCalledTimes(2);
    expect(verifyRedemptionTokenForPartner).toHaveBeenLastCalledWith('WB-BOOST');
  });

  it('says when the bill is below the minimum and still lets staff verify', async () => {
    verifyRedemptionTokenForPartner
      .mockResolvedValueOnce({
        success: false,
        needsBill: true,
        sessionId: '55555555-5555-4555-8555-555555555555',
        minSpendCents: 4000,
        message: 'This guest locked a Boost. Enter the eligible bill subtotal, then verify the code.',
      })
      .mockResolvedValueOnce({
        success: true,
        redemptionDetails: {
          email: null,
          restaurantName: 'North Grill',
          verifiedAt: 'Nov 4, 2026, 3:00 PM',
        },
        newBadgesEarned: [],
        hideDiscountAmount: false,
        sealedDiscountCents: 1500,
        sealedMinSpendCents: 4000,
        confirmedTotalDiscountCents: 0,
        confirmedBaseDiscountCents: 0,
        confirmedBoostDiscountCents: 0,
        needsSubtotal: false,
      });
    confirmPartnerBillSubtotal.mockResolvedValue({
      ok: true,
      quote: {
        baseDiscountCents: 0,
        boostDiscountCents: 0,
        totalDiscountCents: 0,
        eligibleSubtotalCents: 2000,
        belowMinimum: true,
      },
    });
    render(<PartnerRedeemClient restaurantName="North Grill" slug="north-grill" />);
    fireEvent.change(screen.getByLabelText('Customer code'), { target: { value: 'WB-LOW' } });
    fireEvent.submit(screen.getByLabelText('Customer code').closest('form') as HTMLFormElement);
    await screen.findByLabelText('Eligible subtotal');
    fireEvent.change(screen.getByLabelText('Eligible subtotal'), { target: { value: '20.00' } });
    fireEvent.submit(screen.getByLabelText('Eligible subtotal').closest('form') as HTMLFormElement);
    const note = await screen.findByText(/below the offer minimum/);
    expect(note.textContent).toContain('so the Boost does not apply');
    expect(note.textContent).toContain('You can still verify the visit');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    const verified = await screen.findByText('Verified');
    const status = verified.closest('[role="status"]');
    expect(status?.textContent).toContain('Wanderbite covers $0');
    expect(status?.textContent).toContain('Boost $0');
  });
});
