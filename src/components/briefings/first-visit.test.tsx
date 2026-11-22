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

  it('shows only stored fields, the Chicago date, and Sample, with no source link', async () => {
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
    expect(view.querySelectorAll('a')).toHaveLength(0);
    expect(text).not.toContain('Source');
    expect(text).not.toContain('example.com');
  });

  it('hides the stored fields that are not on the member card', async () => {
    const view = await render(
      <FirstVisitBriefing
        headingId="brief-member"
        facts={[
          fact(),
          fact({
            field: 'vibe',
            label: 'Vibe',
            text: 'The room is cozy and candlelit.',
            sourceUrl: 'https://example.com/e06-vibe',
          }),
          fact({
            field: 'known_for',
            label: 'Known for',
            text: 'Known for brisket and ribs.',
            sourceUrl: 'https://example.com/e06-known',
          }),
          fact({
            field: 'good_for',
            label: 'Good for',
            text: 'Good for kids.',
            sourceUrl: 'https://example.com/e06-good',
          }),
          fact({
            field: 'seating',
            label: 'Seating',
            text: 'Dogs are welcome on the patio.',
            sourceUrl: 'https://example.com/e06-seating',
          }),
          fact({
            field: 'reservations',
            label: 'Reservations',
            text: 'Walk-ins are welcome.',
            sourceUrl: 'https://example.com/e06-reservations',
          }),
        ]}
      />,
    );
    const text = view.textContent ?? '';
    expect(text).toContain('Parking');
    expect(text).toContain('Sample note: the lot is behind the building.');
    expect(text).not.toContain('Vibe');
    expect(text).not.toContain('cozy');
    expect(text).not.toContain('Known for');
    expect(text).not.toContain('brisket');
    expect(text).not.toContain('Good for');
    expect(text).not.toContain('Seating');
    expect(text).not.toContain('patio');
    expect(text).not.toContain('Reservations');
    expect(text).not.toContain('Walk-ins');
    expect(view.querySelectorAll('a')).toHaveLength(0);
  });

  it('shows one about paragraph and hides labeled facts and sources', async () => {
    const view = await render(
      <FirstVisitBriefing
        headingId="brief-about"
        facts={[
          fact({
            field: 'about',
            label: 'About',
            text: 'A lively room. Order the brisket. Tip: ask for the end cut.',
            sourceUrl: 'https://example.com/e06-about',
            sampleLabel: null,
          }),
          fact(),
        ]}
      />,
    );
    const text = view.textContent ?? '';
    expect(text).toContain('First visit');
    expect(text).toContain('A lively room. Order the brisket. Tip: ask for the end cut.');
    expect(text).not.toContain('About');
    expect(text).not.toContain('Parking');
    expect(text).not.toContain('Sample note');
    expect(text).not.toContain('Checked');
    expect(text).not.toContain('Source');
    expect(text).not.toContain('example.com');
    expect(view.querySelectorAll('a')).toHaveLength(0);
    expect(view.querySelectorAll('li')).toHaveLength(0);
  });

  it('shows an about paragraph of 401 to 600 characters and hides 601', async () => {
    const paragraph = 'A'.repeat(475);
    const shown = await render(
      <FirstVisitBriefing
        headingId="brief-long-about"
        facts={[
          fact({
            field: 'about',
            label: 'About',
            text: paragraph,
            sampleLabel: null,
          }),
          fact(),
        ]}
      />,
    );
    expect(shown.textContent).toContain(paragraph);
    expect(shown.textContent).not.toContain('Parking');
    await act(async () => {
      root?.unmount();
    });
    shown.remove();

    const hidden = await render(
      <FirstVisitBriefing
        headingId="brief-too-long-about"
        facts={[
          fact({
            field: 'about',
            label: 'About',
            text: 'A'.repeat(601),
            sampleLabel: null,
          }),
          fact({
            field: 'parking',
            label: 'Parking',
            text: 'P'.repeat(401),
            sampleLabel: null,
          }),
        ]}
      />,
    );
    expect(hidden.textContent).not.toContain('A'.repeat(601));
    expect(hidden.textContent).not.toContain('Parking');
    expect(hidden.textContent).not.toContain('P'.repeat(401));
    expect(hidden.querySelector('section')).toBeNull();
  });

  it('keeps labeled facts when the about row is not in the list', async () => {
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
    expect(view.textContent).toContain('Parking');
    expect(view.textContent).toContain('A free parking lot is listed.');
    expect(view.textContent).toContain('Checked Nov 4, 2026');
    expect(view.querySelector('a')).toBeNull();
    expect(view.textContent).not.toContain('Google Maps');
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
