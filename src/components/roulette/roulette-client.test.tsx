import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouletteClient } from '@/components/roulette/roulette-client';
import { RouletteOptionsFields, type RouletteSelections } from '@/components/roulette/roulette-options-fields';

vi.mock('@/app/actions/bite-notes', () => ({
  getPublicReviews: vi.fn(async () => ({ ok: true, data: [] })),
}));

const SPIN = {
  restaurantId: '11111111-1111-4111-8111-111111111111',
  restaurantName: 'Umai Sushi',
  reason: 'A quiet room for two.',
  cuisine_tags: ['Japanese'],
  neighborhood: 'McKinney',
  address: '1 Main St',
  price_range: '$$',
  image_url: null,
  google_place_id: null,
  selectionMode: 'random_fallback',
};

const EMPTY_SELECTIONS: RouletteSelections = {
  vibe: null,
  timeOfDay: null,
  dietaryFlags: [],
  priceRange: null,
  preferredCuisine: null,
};

function stubSpin() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(SPIN), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

async function showResult(subscriptionStatus: string | null = null) {
  render(<RouletteClient subscriptionStatus={subscriptionStatus} />);
  fireEvent.submit(screen.getByRole('button', { name: 'Find a spot' }).closest('form')!);
  expect(await screen.findByRole('heading', { name: 'Umai Sushi' })).toBeTruthy();
}

function expectJoinUpsell() {
  const link = screen.getByRole('link', { name: 'Join for $15/month →' });
  expect(link.getAttribute('href')).toBe('/pricing');
  expect(screen.getByText(/Wanderbite members see the discount on each challenge/)).toBeTruthy();
}

describe('Discover join upsell', () => {
  beforeEach(() => {
    stubSpin();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([null, 'inactive', 'past_due'])(
    'keeps the join link when subscription_status is %s',
    async (status) => {
      await showResult(status);
      expectJoinUpsell();
    },
  );

  it('hides the join link only for an active member', async () => {
    await showResult('active');
    expect(screen.queryByRole('link', { name: 'Join for $15/month →' })).toBeNull();
    expect(screen.queryByText(/Wanderbite members see the discount/)).toBeNull();
  });
});

describe('roulette cuisine chips', () => {
  afterEach(() => {
    cleanup();
  });

  it('wraps cuisine chips without a clipping box', () => {
    render(
      <RouletteOptionsFields
        variant="page"
        selections={EMPTY_SELECTIONS}
        onChange={() => {}}
        exclusionsSummary={null}
      />,
    );
    const pizza = screen.getByRole('button', { name: 'Pizza' });
    const group = pizza.parentElement;
    expect(group?.className).toContain('flex-wrap');
    expect(group?.className ?? '').not.toMatch(/max-h-|overflow-/);
    expect(screen.getByRole('button', { name: 'Vegetarian-Forward' })).toBeTruthy();
  });
});
