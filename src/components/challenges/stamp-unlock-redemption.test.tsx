import { act } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { format } from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRedemptionCode } from '@/app/actions/get-redemption-code';
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

function renderIssued(expiresAt: string) {
  return render(
    <ShowRedemptionCode
      {...base}
      code="WB-LIVE1"
      expiresAt={expiresAt}
      status="issued"
      verifiedAtIso={null}
    />,
  );
}

describe('redemption stamp unlock', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(getRedemptionCode).mockReset();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(document, 'visibilityState');
    vi.useRealTimers();
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

  it('flips an issued code to verified and slams once', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-11-05T01:00:00.000Z').getTime();
    vi.setSystemTime(start);
    const verifiedAt = new Date(start).toISOString();
    vi.mocked(getRedemptionCode).mockResolvedValue({ state: 'verified', verifiedAt });
    renderIssued(new Date(start + 14 * 60 * 1000).toISOString());

    expect(screen.getByText('WB-LIVE1')).toBeTruthy();
    expect(document.querySelector('svg')?.getAttribute('class') ?? '').not.toMatch(/animate|shimmer|wb-stamp/);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getAllByText('Already verified').length).toBeGreaterThan(0);
    expect(screen.queryByText('WB-LIVE1')).toBeNull();
    expect(document.querySelector('svg')).toBeNull();
    expect(screen.getByRole('link', { name: /North Grill/ }).className).toContain('wb-stamp-slam');
    expect(screen.getByText('New stamp: North Grill')).toBeTruthy();
    expect(screen.getByText(format(new Date(verifiedAt), 'PPp'))).toBeTruthy();
    expect(vi.mocked(getRedemptionCode)).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(vi.mocked(getRedemptionCode)).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.wb-stamp-slam')).toHaveLength(1);
    const saved = JSON.parse(window.localStorage.getItem(SEEN_STAMPS_STORAGE_KEY) ?? '') as {
      ids: string[];
      seeded: boolean;
    };
    expect(saved.ids).toEqual(['red-live']);
    expect(saved.seeded).toBe(false);
  });

  it('stops polling after the code expires', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-11-05T01:00:00.000Z').getTime();
    vi.setSystemTime(start);
    const expiresAt = new Date(start - 1_000).toISOString();
    vi.mocked(getRedemptionCode).mockResolvedValue({ state: 'expired', expiresAt });
    renderIssued(new Date(start + 14 * 60 * 1000).toISOString());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getAllByText('Code expired. Get a new one').length).toBeGreaterThan(0);
    expect(screen.queryByText('WB-LIVE1')).toBeNull();
    expect(vi.mocked(getRedemptionCode)).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(vi.mocked(getRedemptionCode)).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.wb-stamp-slam')).toBeNull();
  });

  it('stops polling while the tab is hidden', async () => {
    vi.useFakeTimers();
    const start = new Date('2026-11-05T01:00:00.000Z').getTime();
    vi.setSystemTime(start);
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    vi.mocked(getRedemptionCode).mockResolvedValue({
      state: 'issued',
      code: 'WB-LIVE1',
      expiresAt: new Date(start + 14 * 60 * 1000).toISOString(),
    });
    renderIssued(new Date(start + 14 * 60 * 1000).toISOString());

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(vi.mocked(getRedemptionCode)).not.toHaveBeenCalled();
    expect(screen.getByText('WB-LIVE1')).toBeTruthy();
    expect(document.querySelector('.wb-stamp-slam')).toBeNull();
    expect(document.querySelector('svg')?.getAttribute('class') ?? '').not.toMatch(/animate|shimmer|wb-stamp/);
  });
});