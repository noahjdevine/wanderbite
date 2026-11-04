import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRedemptionCode = vi.fn();
const redeemChallengeItem = vi.fn();

vi.mock('@/app/actions/get-redemption-code', () => ({
  getRedemptionCode: (...args: unknown[]) => getRedemptionCode(...args),
}));

vi.mock('@/app/actions/redeem-challenge', () => ({
  redeemChallengeItem: (...args: unknown[]) => redeemChallengeItem(...args),
}));

import { ShowRedemptionCode } from '@/components/challenges/show-redemption-code';

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
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
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
    expect(view.textContent).toMatch(/Code expires in 14:/);
    expect(view.textContent).not.toContain('Code expires in 15:00');
    const status = view.querySelector('[aria-live="polite"]');
    expect(status?.textContent).toMatch(/Code expires in 14:/);
    expect(view.querySelector('svg')?.getAttribute('class') ?? '').not.toMatch(/animate/);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(getRedemptionCode).toHaveBeenCalledWith('red-1');
    expect(view.textContent).toContain('This code expired. Get a new one');
    expect(view.textContent).not.toContain('WB-LIVE1');
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
    expect(view.textContent).toContain('This code expired. Get a new one');
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
    expect(closed.textContent).toContain('This code expired. Get a new one');
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
    expect(verified.textContent).not.toContain('Get a new one');
    expect(redeemChallengeItem).not.toHaveBeenCalled();
  });
});
