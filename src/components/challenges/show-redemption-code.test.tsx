import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRedemptionCode = vi.fn();
const redeemChallengeItem = vi.fn();
const refreshRouter = vi.hoisted(() => vi.fn());

vi.mock('@/app/actions/get-redemption-code', () => ({
  getRedemptionCode: (...args: unknown[]) => getRedemptionCode(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshRouter, push: vi.fn() }),
}));

vi.mock('@/app/actions/redeem-challenge', () => ({
  redeemChallengeItem: (...args: unknown[]) => redeemChallengeItem(...args),
}));

import { ShowRedemptionCode } from '@/components/challenges/show-redemption-code';
import { VERIFIED_LEVEL_REFRESH_MS } from '@/lib/progression/verified-level-refresh';

const base = {
  redemptionId: 'red-1',
  challengeItemId: 'item-1',
  restaurantName: 'North Grill',
  restaurantSlug: 'north-grill',
  discountLabel: '$10 off',
  minSpendLabel: '$40 minimum spend',
  redemptionDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  canReissue: true,
};

describe('ShowRedemptionCode', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    getRedemptionCode.mockReset();
    redeemChallengeItem.mockReset();
    refreshRouter.mockReset();
    sessionStorage.clear();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    sessionStorage.clear();
  });

  async function render(node: ReactElement) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(node);
    });
    return container;
  }

  it('shows a confirmed total beside the live QR and keeps the 15-minute copy', async () => {
    const expiresAt = new Date(Date.now() + 14 * 60 * 1000).toISOString();
    const view = await render(
      <ShowRedemptionCode
        {...base}
        code="WB-LIVE1"
        expiresAt={expiresAt}
        status="issued"
        confirmedDiscountLabel="$25 off"
      />,
    );
    expect(view.querySelector('[data-confirmed-discount]')?.textContent).toBe('$25 off');
    expect(view.querySelector('svg')).toBeTruthy();
    expect(view.textContent).toContain('WB-LIVE1');
    expect(view.textContent).toContain('$10 off');
    expect(view.textContent).toContain('Codes expire after 15 minutes.');
    expect(view.textContent).not.toContain('$0');
    expect(view.querySelector('[data-boost-lock]')).toBeNull();
  });

  it('mentions a locked Boost on the code screen', async () => {
    const view = await render(
      <ShowRedemptionCode
        {...base}
        code="WB-LIVE1"
        expiresAt={new Date(Date.now() + 14 * 60 * 1000).toISOString()}
        status="issued"
        boostLockNote="+$5 Boost locked. It will apply once the restaurant confirms the bill."
      />,
    );
    expect(view.querySelector('[data-boost-lock]')?.textContent).toBe(
      '+$5 Boost locked. It will apply once the restaurant confirms the bill.',
    );
    expect(view.textContent).toContain('WB-LIVE1');
    expect(view.textContent).not.toContain('You saved');
  });

  it('shows the stored settlement and does not say the Boost is still locked', async () => {
    const view = await render(
      <ShowRedemptionCode
        {...base}
        code={null}
        expiresAt={null}
        status="verified"
        verifiedAt="Nov 4, 2026, 7:00 PM"
        discountLabel="$10 off"
        minSpendLabel="$40 minimum spend"
        boostLockNote="Boost locked: $5"
        settledSummary="You saved $15 ($10 off + $5 Boost)"
      />,
    );
    expect(view.querySelector('[data-settled-summary]')?.textContent).toBe(
      'You saved $15 ($10 off + $5 Boost)',
    );
    expect(view.textContent).toContain('Verified');
    expect(view.textContent).not.toContain('$40 minimum spend');
    expect(view.textContent).not.toContain('Boost locked');
    expect(view.textContent).not.toContain('Already verified');
    expect(view.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'You saved $15 ($10 off + $5 Boost)',
    );
  });

  it('counts down from the server deadline and re-reads when the page regains focus', async () => {
    const expiresAt = new Date(Date.now() + 14 * 60 * 1000 + 20_000).toISOString();
    getRedemptionCode.mockResolvedValue({
      state: 'expired',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const view = await render(
      <ShowRedemptionCode
        {...base}
        code="WB-LIVE1"
        expiresAt={expiresAt}
        status="issued"
      />,
    );
    expect(view.textContent).toContain('WB-LIVE1');
    expect(view.textContent).toContain('Codes expire after 15 minutes.');
    expect(view.textContent).toMatch(/Code expires in 14:/);
    expect(view.textContent).not.toContain('Code expires in 15:00');
    const countdown = view.querySelector('p.tabular-nums');
    expect(countdown?.textContent).toMatch(/Code expires in 14:/);
    expect(countdown?.hasAttribute('aria-live')).toBe(false);
    const live = () => view.querySelector('[aria-live="polite"]');
    expect(live()?.textContent).toBe('Code issued');
    expect(live()?.textContent).not.toMatch(/\d:\d/);
    expect(view.querySelector('svg')?.getAttribute('class') ?? '').not.toMatch(/animate/);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(getRedemptionCode).toHaveBeenCalledWith('red-1');
    expect(view.textContent).toContain('Code expired. Get a new one');
    expect(view.textContent).not.toContain('WB-LIVE1');
    expect(live()?.textContent).toBe('Code expired. Get a new one');
    expect(view.querySelector('p.tabular-nums')).toBeNull();
  });

  it('announces one minute left once while the visible countdown keeps ticking', async () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-11-05T01:00:00.000Z').getTime();
      vi.setSystemTime(start);
      const expiresAt = new Date(start + 70_000).toISOString();
      getRedemptionCode.mockResolvedValue({
        state: 'issued',
        code: 'WB-LIVE1',
        expiresAt,
      });
      const view = await render(
        <ShowRedemptionCode
          {...base}
          code="WB-LIVE1"
          expiresAt={expiresAt}
          status="issued"
        />,
      );
      const live = () => view.querySelector('[aria-live="polite"]');
      const countdown = () => view.querySelector('p.tabular-nums');
      expect(live()?.textContent).toBe('Code issued');
      expect(countdown()?.textContent).toBe('Code expires in 01:10');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11_000);
      });
      expect(live()?.textContent).toBe('1 minute left');
      const atMinute = countdown()?.textContent;
      expect(atMinute).toMatch(/Code expires in 00:/);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(live()?.textContent).toBe('1 minute left');
      expect(countdown()?.textContent).not.toBe(atMinute);
      expect(view.textContent).toContain('WB-LIVE1');
      expect(getRedemptionCode).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reissues from the expired state', async () => {
    const nextExpires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    redeemChallengeItem.mockResolvedValue({
      ok: true,
      data: {
        token: 'WB-NEXT1',
        redeemedAt: '2026-11-05T01:00:00.000Z',
        redemptionId: 'red-1',
        expiresAt: nextExpires,
      },
    });
    const view = await render(
      <ShowRedemptionCode
        {...base}
        code={null}
        expiresAt={new Date(Date.now() - 60_000).toISOString()}
        status="expired"
      />,
    );
    expect(view.textContent).toContain('Code expired. Get a new one');
    const button = Array.from(view.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Get a new one'),
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error('missing reissue button');
    await act(async () => {
      button.click();
    });
    expect(redeemChallengeItem).toHaveBeenCalledWith('item-1');
    expect(view.textContent).toContain('WB-NEXT1');
    expect(view.textContent).toMatch(/Code expires in 1[45]:/);
    expect(view.querySelector('[aria-live="polite"]')?.textContent).toBe('Code reissued');
    expect(view.querySelector('p.tabular-nums')?.hasAttribute('aria-live')).toBe(false);
  });

  it('hides reissue when the visit window is closed and keeps a verified visit quiet', async () => {
    const closed = await render(
      <ShowRedemptionCode
        {...base}
        canReissue={false}
        code={null}
        expiresAt={new Date(Date.now() - 60_000).toISOString()}
        redemptionDeadline={new Date(Date.now() - 60_000).toISOString()}
        status="expired"
      />,
    );
    expect(closed.textContent).toContain('This adventure is no longer active.');
    expect(closed.textContent).not.toContain('Get a new one');
    expect(
      Array.from(closed.querySelectorAll('button')).some((node) => node.textContent === 'Get a new one'),
    ).toBe(false);

    act(() => {
      root?.unmount();
    });
    container?.remove();
    const verified = await render(
      <ShowRedemptionCode
        {...base}
        canReissue={false}
        code={null}
        expiresAt={null}
        status="verified"
        verifiedAt="Nov 4, 2026, 7:00 PM"
      />,
    );
    expect(verified.textContent).toContain('Already verified');
    expect(verified.querySelector('[aria-live="polite"]')?.textContent).toBe('Already verified');
    expect(verified.textContent).not.toContain('Get a new one');
    expect(redeemChallengeItem).not.toHaveBeenCalled();
  });

  it('replaces the open code with Verified when the status poll sees a verify', async () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-11-05T01:00:00.000Z').getTime();
      vi.setSystemTime(start);
      const expiresAt = new Date(start + 10 * 60 * 1000).toISOString();
      getRedemptionCode.mockResolvedValue({
        state: 'verified',
        verifiedAt: '2026-11-05T01:00:05.000Z',
      });
      const view = await render(
        <ShowRedemptionCode {...base} code="WB-LIVE1" expiresAt={expiresAt} status="issued" />,
      );
      expect(view.textContent).toContain('WB-LIVE1');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(view.textContent).not.toContain('WB-LIVE1');
      expect(view.textContent).toContain('Verified');
      expect(view.textContent).toContain('Nov 4, 2026, 7:00 PM CT');
      expect(view.querySelector('a[href="/challenges"]')?.textContent).toContain('Back to challenges');
      expect(refreshRouter).toHaveBeenCalledTimes(1);
      expect(getRedemptionCode).toHaveBeenCalledWith('red-1');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(VERIFIED_LEVEL_REFRESH_MS);
      });
      expect(refreshRouter).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(VERIFIED_LEVEL_REFRESH_MS);
      });
      expect(refreshRouter).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the code when the page props become verified and ignores a later issued read', async () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-11-05T01:00:00.000Z').getTime();
      vi.setSystemTime(start);
      const expiresAt = new Date(start + 10 * 60 * 1000).toISOString();
      getRedemptionCode.mockResolvedValue({
        state: 'issued',
        code: 'WB-LIVE1',
        expiresAt,
      });
      const view = await render(
        <ShowRedemptionCode {...base} code="WB-LIVE1" expiresAt={expiresAt} status="issued" />,
      );
      expect(view.textContent).toContain('WB-LIVE1');
      await act(async () => {
        root?.render(
          <ShowRedemptionCode
            {...base}
            code="WB-LIVE1"
            expiresAt={expiresAt}
            status="verified"
            verifiedAt="Nov 4, 2026, 7:00 PM"
            verifiedAtIso="2026-11-04T18:00:00.000Z"
          />,
        );
      });
      expect(view.textContent).not.toContain('WB-LIVE1');
      expect(view.textContent).toContain('Verified');
      expect(view.querySelector('a[href="/challenges"]')?.textContent).toContain('Back to challenges');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(view.textContent).not.toContain('WB-LIVE1');
      expect(view.textContent).toContain('Already verified');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays Verified when the screen remounts with the old issued props', async () => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await render(
      <ShowRedemptionCode
        {...base}
        code={null}
        expiresAt={null}
        status="verified"
        verifiedAt="Nov 4, 2026, 7:00 PM"
        verifiedAtIso="2026-11-04T18:00:00.000Z"
      />,
    );

    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;

    const again = await render(
      <ShowRedemptionCode {...base} code="WB-LIVE1" expiresAt={expiresAt} status="issued" />,
    );
    expect(again.textContent).not.toContain('WB-LIVE1');
    expect(again.textContent).toContain('Verified');
    expect(again.querySelector('a[href="/challenges"]')?.textContent).toContain('Back to challenges');
  });
});
