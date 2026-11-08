import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedChallengeItem } from '@/app/actions/generate-challenge';
import { AdventureTicket } from '@/components/challenges/adventure-ticket';
import { BOOST_CHECK_IN_LABEL } from '@/components/challenges/boost-check-in';

const checkInMemberBoost = vi.fn();
const getCurrentPosition = vi.fn();

vi.mock('@/app/actions/member-boost-arrival', () => ({
  checkInMemberBoost: (...args: unknown[]) => checkInMemberBoost(...args),
}));

vi.mock('@/app/actions/get-redemption-code', () => ({
  getRedemptionCode: vi.fn(),
}));

vi.mock('@/components/restaurants/restaurant-reviews', () => ({
  RestaurantReviews: () => null,
}));

vi.mock('@/components/restaurants/restaurant-photo', () => ({
  RestaurantPhoto: () => <span data-photo="fixed" />,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const CODE_LABEL = "I'm here — get my code";

function item(overrides: {
  status?: 'assigned' | 'redeemed';
  offerVersionId?: string | null;
  lat?: number | null;
  lon?: number | null;
} = {}): GeneratedChallengeItem {
  return {
    challengeItem: {
      id: '44444444-4444-4444-8444-444444444444',
      cycle_id: 'cycle-1',
      restaurant_id: 'restaurant-1',
      slot_number: 1,
      status: overrides.status ?? 'assigned',
      offer_version_id: overrides.offerVersionId === undefined ? 'version-1' : overrides.offerVersionId,
      redemption_deadline: '2026-12-01T00:00:00.000Z',
      credit_id: null,
    },
    restaurant: {
      id: 'restaurant-1',
      name: 'North Grill',
      cuisine_tags: ['thai'],
      address: null,
      lat: overrides.lat === undefined ? 33.2 : overrides.lat,
      lon: overrides.lon === undefined ? -96.6 : overrides.lon,
      status: 'active',
      market_id: 'market-1',
      org_id: 'org-1',
    },
    offer: { available: true, discount_amount_cents: 1000, min_spend_cents: 4000 },
    visitStatus: 'ready',
  };
}

describe('Boost check-in on the challenge ticket', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    checkInMemberBoost.mockReset();
    getCurrentPosition.mockReset();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function render(node: ReactElement) {
    await act(async () => {
      root.render(node);
    });
    return container;
  }

  function ticket(boostCheckIn: boolean, row = item()) {
    return (
      <AdventureTicket
        item={row}
        cycleCreatedAt={new Date().toISOString()}
        canSwap={false}
        swapsRemaining={1}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
        boostCheckIn={boostCheckIn}
      />
    );
  }

  it('hides Boost check-in when the flag is off and keeps the redemption code', async () => {
    const view = await render(ticket(false));
    expect(view.textContent).toContain(CODE_LABEL);
    expect(view.textContent).not.toContain(BOOST_CHECK_IN_LABEL);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('asks for a location only after the member taps, and only for a bound pin', async () => {
    const hidden = await render(ticket(true, item({ offerVersionId: null })));
    expect(hidden.textContent).toContain(CODE_LABEL);
    expect(hidden.textContent).not.toContain(BOOST_CHECK_IN_LABEL);

    const view = await render(ticket(true));
    expect(view.textContent).toContain(CODE_LABEL);
    expect(view.textContent).toContain(BOOST_CHECK_IN_LABEL);
    expect(getCurrentPosition).not.toHaveBeenCalled();

    const button = Array.from(view.querySelectorAll('button')).find((node) =>
      node.textContent?.includes(BOOST_CHECK_IN_LABEL),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.click();
    });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    const options = getCurrentPosition.mock.calls[0]?.[2] as { maximumAge?: number };
    expect(options.maximumAge).toBe(0);
  });

  it('forwards browser accuracy of 100 metres and just either side without rewriting it', async () => {
    checkInMemberBoost.mockResolvedValue({ ok: false, code: 'boost_not_available' });
    const view = await render(ticket(true));
    const button = Array.from(view.querySelectorAll('button')).find((node) =>
      node.textContent?.includes(BOOST_CHECK_IN_LABEL),
    );
    for (const accuracy of [99.9, 100, 100.1]) {
      getCurrentPosition.mockImplementation((success: (position: GeolocationPosition) => void) => {
        success({
          coords: {
            latitude: 33.2,
            longitude: -96.6,
            accuracy,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
            toJSON() {
              return {};
            },
          },
          timestamp: 1_700_000_000_000,
          toJSON() {
            return {};
          },
        });
      });
      await act(async () => {
        button?.click();
      });
    }
    expect(checkInMemberBoost.mock.calls.map((call) => (call[0] as { location: { accuracy: number } }).location.accuracy)).toEqual([
      99.9,
      100,
      100.1,
    ]);
  });
});
