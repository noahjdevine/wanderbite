import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findPartnerArrivalItems = vi.fn();
const uploadPartnerBillReceipt = vi.fn();
const confirmPartnerBillSubtotal = vi.fn();
const createBoostArrivalSession = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/app/actions/partner-auth', () => ({
  logoutPartner: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/app/actions/partner-bill-scan', () => ({
  findPartnerArrivalItems: (...args: unknown[]) => findPartnerArrivalItems(...args),
  uploadPartnerBillReceipt: (...args: unknown[]) => uploadPartnerBillReceipt(...args),
  confirmPartnerBillSubtotal: (...args: unknown[]) => confirmPartnerBillSubtotal(...args),
}));

vi.mock('@/app/actions/partner-boost-arrival', () => ({
  createBoostArrivalSession: (...args: unknown[]) => createBoostArrivalSession(...args),
}));

import { PartnerArrivalClient } from './partner-arrival-client';

const ITEM = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  findPartnerArrivalItems.mockReset();
  uploadPartnerBillReceipt.mockReset();
  confirmPartnerBillSubtotal.mockReset();
  createBoostArrivalSession.mockReset();
});

async function openCheckedInVisit() {
  findPartnerArrivalItems.mockResolvedValue({
    ok: true,
    items: [{ challengeItemId: ITEM, memberName: 'Ada Guest', openSessionId: null }],
  });
  createBoostArrivalSession.mockResolvedValue({
    ok: true,
    session: { id: SESSION },
    quote: { totalDiscountCents: 0, belowMinimum: true, eligibleSubtotalCents: 0 },
  });
  render(<PartnerArrivalClient restaurantName="North Grill" slug="north-grill" />);
  fireEvent.change(screen.getByLabelText('Guest email'), { target: { value: 'ada@example.com' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Find challenge' }).closest('form') as HTMLFormElement);
  expect(await screen.findByRole('heading', { name: 'Ada Guest' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Check in' }));
  expect(await screen.findByText('Checked in. A receipt scan does not apply a discount.')).toBeTruthy();
  expect(createBoostArrivalSession).toHaveBeenCalledWith({
    challengeItemId: ITEM,
    idempotencyKey: `e07-arrival:${ITEM}`,
    eligibleSubtotalCents: 0,
  });
  expect(confirmPartnerBillSubtotal).not.toHaveBeenCalled();
}

describe('partner arrival screen', () => {
  it('checks in without a discount and requires a typed amount under 0.8', async () => {
    await openCheckedInVisit();
    uploadPartnerBillReceipt.mockResolvedValue({
      ok: true,
      proposalId: '88888888-8888-4888-8888-888888888888',
      source: 'azure_prebuilt_receipt',
      grossCents: 10000,
      proposedEligibleSubtotalCents: 8200,
      confidence: 0.5,
      requiresManualEntry: true,
      uncertaintyFlags: ['low_confidence'],
    });
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'receipt.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Receipt image'), { target: { files: [file] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Upload receipt' }).closest('form') as HTMLFormElement);
    expect(await screen.findByText('Parsed total $100')).toBeTruthy();
    expect(screen.getByText('Confidence 0.50')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm $82' })).toBeNull();
    expect(confirmPartnerBillSubtotal).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Eligible subtotal'), { target: { value: '82.00' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Confirm entered amount' }).closest('form') as HTMLFormElement);
    expect(confirmPartnerBillSubtotal).toHaveBeenCalledWith({
      sessionId: SESSION,
      eligibleSubtotalCents: 8200,
      proposalId: '88888888-8888-4888-8888-888888888888',
    });
  });

  it('confirms a high-confidence total only after the partner clicks', async () => {
    await openCheckedInVisit();
    uploadPartnerBillReceipt.mockResolvedValue({
      ok: true,
      proposalId: '88888888-8888-4888-8888-888888888888',
      source: 'azure_prebuilt_receipt',
      grossCents: 10000,
      proposedEligibleSubtotalCents: 8200,
      confidence: 0.95,
      requiresManualEntry: false,
      uncertaintyFlags: [],
    });
    confirmPartnerBillSubtotal.mockResolvedValue({
      ok: true,
      quote: { totalDiscountCents: 1000, belowMinimum: false, eligibleSubtotalCents: 8200 },
    });
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'receipt.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Receipt image'), { target: { files: [file] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Upload receipt' }).closest('form') as HTMLFormElement);
    const confirm = await screen.findByRole('button', { name: 'Confirm $82' });
    expect(confirmPartnerBillSubtotal).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    expect(confirmPartnerBillSubtotal).toHaveBeenCalledWith({
      sessionId: SESSION,
      eligibleSubtotalCents: 8200,
      proposalId: '88888888-8888-4888-8888-888888888888',
    });
    expect(await screen.findByText('Confirmed $82. Discount on this quote: $10.')).toBeTruthy();
  });
});
