import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedChallengeItem } from '@/app/actions/generate-challenge';
import {
  CHECK_HOURS_LABEL,
  OPTIONAL_ACTIVITY_LABEL,
  type ActivitySuggestion,
} from '@/lib/activities/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/actions/get-redemption-code', () => ({
  getRedemptionCode: vi.fn(),
}));

vi.mock('@/app/actions/bite-notes', () => ({
  saveBiteNote: vi.fn(),
  toggleNoteVisibility: vi.fn(),
}));

vi.mock('@/components/restaurants/restaurant-reviews', () => ({
  RestaurantReviews: () => null,
}));

vi.mock('@/components/restaurants/restaurant-photo', () => ({
  RestaurantPhoto: () => null,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { NearbyIdeas } from '@/components/activities/nearby-ideas';
import { RestaurantCard } from '@/components/dashboard/restaurant-card';

function suggestion(overrides: Partial<ActivitySuggestion> = {}): ActivitySuggestion {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Sample Square Walk',
    categoryLabel: 'Walk',
    durationLabel: 'Typical duration: 40 min',
    costLabel: 'Free',
    hoursLabel: CHECK_HOURS_LABEL,
    hoursKnown: false,
    sourceUrl: 'https://example.com/sample-square-walk',
    sampleLabel: 'Sample',
    weatherLabel: 'Weather dependent',
    bookingLabel: null,
    locationMethod: 'coordinates',
    ...overrides,
  };
}

function item(): GeneratedChallengeItem {
  return {
    challengeItem: {
      id: 'item-1',
      cycle_id: 'cycle-1',
      restaurant_id: 'rest-a',
      slot_number: 1,
      status: 'assigned',
    },
    restaurant: {
      id: 'rest-a',
      name: 'Alpha Kitchen',
      cuisine_tags: ['thai'],
      address: '1 Sample St, McKinney, TX 75069',
      lat: 33.1972,
      lon: -96.6156,
      status: 'active',
      market_id: 'market-1',
      org_id: 'org-1',
    },
    offer: { available: true, discount_amount_cents: 2000, min_spend_cents: 5000 },
  };
}

describe('nearby activity block', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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

  it('renders nothing when no suggestion qualifies', async () => {
    const view = await render(<NearbyIdeas headingId="nearby-empty" suggestions={[]} />);
    expect(view.textContent).toBe('');
  });

  it('shows two ideas with the optional label, sample badge, and official link', async () => {
    const view = await render(
      <NearbyIdeas
        headingId="nearby-two"
        suggestions={[
          suggestion(),
          suggestion({
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            name: 'Sample Dated Fair',
            categoryLabel: 'Arts',
            costLabel: '$$',
            sampleLabel: 'Sample',
            bookingLabel: 'Booking required',
            weatherLabel: null,
          }),
        ]}
      />,
    );
    const section = view.querySelector('section');
    expect(section?.getAttribute('aria-labelledby')).toBe('nearby-two');
    expect(view.textContent).toContain('Optional nearby idea');
    expect(view.textContent).toContain(OPTIONAL_ACTIVITY_LABEL);
    expect(view.textContent).toContain('Sample Square Walk');
    expect(view.textContent).toContain('Sample Dated Fair');
    expect(view.textContent).toContain('Walk');
    expect(view.textContent).toContain('Typical duration: 40 min');
    expect(view.textContent).toContain('Free');
    expect(view.textContent).toContain('$$');
    expect(view.textContent).toContain('Sample');
    expect(view.textContent).toContain('Weather dependent');
    expect(view.textContent).toContain('Booking required');
    const link = view.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/sample-square-walk');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.textContent).toBe('Official site');
  });

  it('shows the check-hours line and no clock time when hours are unknown', async () => {
    const view = await render(
      <NearbyIdeas headingId="nearby-hours" suggestions={[suggestion({ hoursKnown: false })]} />,
    );
    expect(view.textContent).toContain(CHECK_HOURS_LABEL);
    expect(view.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('does not imply a drive time for a ZIP match', async () => {
    const view = await render(
      <NearbyIdeas
        headingId="nearby-zip"
        suggestions={[
          suggestion({
            name: 'Sample Sports Lot',
            locationMethod: 'zip',
            durationLabel: 'Typical duration: 60 min',
            weatherLabel: null,
          }),
        ]}
      />,
    );
    const text = view.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('drive');
    expect(text.toLowerCase()).not.toContain('miles');
    expect(text).not.toContain('away');
  });

  it('hides the tag row when a restaurant has no tags', async () => {
    const tagged = await render(
      <RestaurantCard
        item={item()}
        cycleCreatedAt="2026-11-01T18:00:00.000Z"
        canSwap={false}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
      />,
    );
    expect(tagged.textContent).toContain('thai');

    const bare = item();
    bare.restaurant.cuisine_tags = [];
    const empty = await render(
      <RestaurantCard
        item={bare}
        cycleCreatedAt="2026-11-01T18:00:00.000Z"
        canSwap={false}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
      />,
    );
    expect(empty.textContent).toContain('Alpha Kitchen');
    expect(empty.textContent).not.toContain('No tags');
  });

  it('places the block under the restaurant on the challenge card', async () => {
    const hidden = await render(
      <RestaurantCard
        item={item()}
        cycleCreatedAt="2026-11-01T18:00:00.000Z"
        canSwap={false}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
      />,
    );
    expect(hidden.textContent).toContain('Alpha Kitchen');
    expect(hidden.textContent).not.toContain('Optional nearby idea');

    const shown = await render(
      <RestaurantCard
        item={item()}
        cycleCreatedAt="2026-11-01T18:00:00.000Z"
        canSwap={false}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
        activities={[suggestion()]}
      />,
    );
    expect(shown.textContent?.indexOf('Alpha Kitchen')).toBeLessThan(
      shown.textContent?.indexOf('Optional nearby idea') ?? -1,
    );
    expect(shown.textContent).toContain('Sample');
    expect(shown.textContent).toContain(CHECK_HOURS_LABEL);
    expect(shown.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });
});
