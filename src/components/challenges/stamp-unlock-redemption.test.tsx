import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShowRedemptionCode } from '@/components/challenges/show-redemption-code';
import { stampRotationDegrees } from '@/lib/passport/passport-board';
import { SEEN_STAMPS_STORAGE_KEY } from '@/lib/passport/stamp-unlock';

vi.mock('@/app/actions/get-redemption-code', () => ({
  getRedemptionCode: vi.fn(),
}));

vi.mock('@/app/actions/redeem-challenge', () => ({
  redeemChallengeItem: vi.fn(),
}));

const base = {
  redemptionId: 'red-live',
  challengeItemId: 'item-1',
  restaurantName: 'North Grill',
  restaurantSlug: 'north-grill',
  discountLabel: '$10 off',
  minSpendLabel: '$40 minimum spend',
  redemptionDeadline: '2026-12-01T00:00:00.000Z',
  canReissue: false,
  cuisineTags: ['Pizza'],
  neighborhood: 'Downtown',
};

describe('redemption stamp unlock', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('plays the slam when the screen is already verified', async () => {
    const verifiedAtIso = new Date().toISOString();
    render(
      <ShowRedemptionCode
        {...base}
        code={null}
        expiresAt={null}
        status="verified"
        verifiedAt="Nov 4, 2026"
        verifiedAtIso={verifiedAtIso}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /North Grill/ }).className).toContain('wb-stamp-slam');
    });
    expect(screen.getByRole('link', { name: /North Grill/ }).getAttribute('data-rotation')).toBe(
      String(stampRotationDegrees('red-live')),
    );
    expect(screen.getByText('New stamp: North Grill')).toBeTruthy();
    expect(screen.getAllByText('Already verified').length).toBeGreaterThan(0);
    const saved = JSON.parse(window.localStorage.getItem(SEEN_STAMPS_STORAGE_KEY) ?? '') as {
      ids: string[];
      seeded: boolean;
    };
    expect(saved.ids).toEqual(['red-live']);
    expect(saved.seeded).toBe(false);
  });

  it('does not invent a verified stamp while the code is still issued', async () => {
    render(
      <ShowRedemptionCode
        {...base}
        code="WB-LIVE1"
        expiresAt={new Date(Date.now() + 10 * 60 * 1000).toISOString()}
        status="issued"
        verifiedAtIso={null}
      />,
    );
    expect(screen.getByText('WB-LIVE1')).toBeTruthy();
    expect(document.querySelector('.wb-stamp-slam')).toBeNull();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(window.localStorage.getItem(SEEN_STAMPS_STORAGE_KEY)).toBeNull();
  });
});