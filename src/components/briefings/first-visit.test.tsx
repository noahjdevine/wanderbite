import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedChallengeItem } from '@/app/actions/generate-challenge';
import type { BriefingFact } from '@/lib/briefings/types';

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

import { FirstVisitBriefing } from '@/components/briefings/first-visit';
import { RestaurantCard } from '@/components/dashboard/restaurant-card';

function fact(overrides: Partial<BriefingFact> = {}): BriefingFact {
  return {
    field: 'parking',
    label: 'Parking',
    text: 'Sample note: the lot is behind the building.',
    sourceUrl: 'https://example.com/e06-parking',
    lastVerifiedAt: '2026-11-05T05:30:00.000Z',
    sampleLabel: 'Sample',
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

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('FirstVisitBriefing', () => {
  beforeEach(() => {
    container = null;
    root = null;
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

  it('renders nothing when the restaurant has no facts', async () => {
    const view = await render(<FirstVisitBriefing headingId="brief-empty" facts={[]} />);
    expect(view.textContent).toBe('');
  });

  it('shows only stored fields, the source, the Chicago date, and Sample', async () => {
    const view = await render(
      <FirstVisitBriefing
        headingId="brief-two"
        facts={[
          fact(),
          fact({
            field: 'duration',
            label: 'Typical visit',
            text: 'Sample note: plan on about an hour.',
            sourceUrl: 'https://example.com/e06-duration',
            lastVerifiedAt: '2026-11-05T06:00:00.000Z',
            sampleLabel: 'Sample',
          }),
        ]}
      />,
    );
    const text = view.textContent ?? '';
    expect(view.querySelector('section')?.getAttribute('aria-labelledby')).toBe('brief-two');
    expect(text).toContain('First visit');
    expect(text).toContain('Parking');
    expect(text).toContain('Typical visit');
    expect(text).not.toContain('Attire');
    expect(text).not.toContain('Accessibility');
    expect(text).toContain('Sample');
    expect(text).toContain('Checked Nov 4, 2026');
    expect(text).toContain('Checked Nov 5, 2026');
    const links = [...view.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com/e06-parking',
      'https://example.com/e06-duration',
    ]);
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(links[0]?.textContent).toBe('Source');
    expect(links[0]?.getAttribute('translate')).toBeNull();
  });

  it('attributes a Google Maps source with the required text', async () => {
    const view = await render(
      <FirstVisitBriefing
        headingId="brief-maps"
        facts={[
          fact({
            sampleLabel: null,
            text: 'A free parking lot is listed.',
            sourceUrl: 'https://maps.google.com/?cid=99',
          }),
        ]}
      />,
    );
    const link = view.querySelector('a');
    expect(link?.textContent).toBe('Google Maps');
    expect(link?.getAttribute('href')).toBe('https://maps.google.com/?cid=99');
    expect(link?.getAttribute('translate')).toBe('no');
    expect(link?.className).toContain('whitespace-nowrap');
    expect(view.textContent).not.toContain('Source');
  });

  it('omits the Sample label when the fact is not a sample', async () => {
    const view = await render(
      <FirstVisitBriefing
        headingId="brief-real"
        facts={[
          fact({
            sampleLabel: null,
            text: 'The lot is behind the building.',
          }),
        ]}
      />,
    );
    expect(view.textContent).toContain('Parking');
    expect(view.textContent).not.toContain('Sample');
  });

  it('places the block under the restaurant and leaves the card unchanged without facts', async () => {
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
    expect(hidden.textContent).not.toContain('First visit');

    const shown = await render(
      <RestaurantCard
        item={item()}
        cycleCreatedAt="2026-11-01T18:00:00.000Z"
        canSwap={false}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
        briefings={[fact()]}
      />,
    );
    const text = shown.textContent ?? '';
    expect(text.indexOf('Alpha Kitchen')).toBeLessThan(text.indexOf('First visit'));
    expect(text).toContain('Checked Nov 4, 2026');
    expect(text).toContain('Sample');
  });
});
