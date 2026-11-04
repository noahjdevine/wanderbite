import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('@/lib/launch-market-server', () => ({
  requireLaunchMarketId: vi.fn(),
}));

import { requireLaunchMarketId } from '@/lib/launch-market-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { RESTAURANTS_EMPTY_MESSAGE, RESTAURANTS_UNAVAILABLE_MESSAGE } from '@/components/locations/locations-client';
import RestaurantsPage from './page';

type Row = {
  id: string;
  name: string;
  cuisine_tags: string[] | null;
  neighborhood: string | null;
  description: string | null;
  price_range: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  image_url: string | null;
  status: string;
  market_id: string;
};

const RAW_ERROR = 'relation "restaurants" does not exist';

function directoryRow(overrides: Partial<Row>): Row {
  return {
    id: 'rest',
    name: 'Grill',
    cuisine_tags: [],
    neighborhood: null,
    description: null,
    price_range: null,
    address: null,
    lat: null,
    lon: null,
    image_url: null,
    status: 'active',
    market_id: 'market-1',
    ...overrides,
  };
}

const rows: Row[] = [
  directoryRow({
    id: 'ada',
    name: 'Ada Grill',
    cuisine_tags: ['Italian'],
    neighborhood: '',
    description: 'A reason to visit',
    price_range: '$$',
    image_url: '/images/restaurant-placeholder.jpg',
    address: '1 Main',
  }),
  directoryRow({
    id: 'bea',
    name: 'Bea Grill',
    neighborhood: '  Downtown ',
    description: '   ',
    cuisine_tags: [],
  }),
  directoryRow({
    id: 'cam',
    name: 'Cam Grill',
    neighborhood: 'Craig Ranch',
    description: 'A quiet patio',
    cuisine_tags: ['  ', 'Thai'],
    price_range: '   ',
  }),
  directoryRow({
    id: 'paused',
    name: 'Paused Grill',
    status: 'paused',
    neighborhood: 'West',
    description: 'should not show',
  }),
  directoryRow({
    id: 'other',
    name: 'Other Market Grill',
    market_id: 'market-2',
    neighborhood: 'East',
  }),
];

function mockDirectory(result: { data: Row[] | null; error: { message: string } | null }) {
  const filters: { col: string; val: string }[] = [];
  let selected = '';
  const builder = {
    select(columns: string) {
      selected = columns;
      return builder;
    },
    eq(col: string, val: string) {
      filters.push({ col, val });
      return builder;
    },
    order() {
      return builder;
    },
    then(
      resolve: (value: { data: Row[] | null; error: { message: string } | null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) {
      const data = result.error
        ? null
        : (result.data ?? []).filter((row) =>
            filters.every((filter) => row[filter.col as 'status' | 'market_id'] === filter.val),
          );
      return Promise.resolve({ data, error: result.error }).then(resolve, reject);
    },
  };
  (getSupabaseAdmin as ReturnType<typeof vi.fn>).mockReturnValue({
    from: () => builder,
  });
  return {
    filters: () => filters,
    selected: () => selected,
  };
}

describe('restaurants page', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    (requireLaunchMarketId as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      marketId: 'market-1',
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('maps the active launch-market rows and counts them', async () => {
    const query = mockDirectory({ data: rows, error: null });
    render(await RestaurantsPage());

    expect(query.filters()).toEqual([
      { col: 'status', val: 'active' },
      { col: 'market_id', val: 'market-1' },
    ]);
    expect(query.selected()).toContain('neighborhood');
    expect(query.selected()).toContain('price_range');
    expect(query.selected()).not.toContain('markets');

    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.queryByText('Paused Grill')).toBeNull();
    expect(screen.queryByText('Other Market Grill')).toBeNull();
    expect(screen.queryByText('should not show')).toBeNull();

    const bea = screen.getByRole('article', { name: 'Bea Grill' });
    expect(bea.textContent).toContain('Downtown');
    expect(bea.textContent).not.toContain('McKinney');
    expect(bea.querySelector('[data-reason]')).toBeNull();

    const ada = screen.getByRole('article', { name: 'Ada Grill' });
    expect(ada.textContent).not.toContain('McKinney');
    expect(ada.querySelector('[data-reason]')?.textContent).toContain('A reason to visit');
    expect(ada.querySelector('[data-price]')?.textContent).toContain('$$');
  });

  it('shows the friendly error and does not render the raw query text', async () => {
    mockDirectory({ data: null, error: { message: RAW_ERROR } });
    render(await RestaurantsPage());
    expect(screen.getByRole('alert').textContent).toBe(RESTAURANTS_UNAVAILABLE_MESSAGE);
    expect(screen.getByRole('link', { name: 'Retry' })).toBeTruthy();
    expect(document.body.textContent).not.toContain(RAW_ERROR);
    expect(document.body.textContent).not.toContain('Failed to load restaurants');
    expect(console.error).toHaveBeenCalled();
  });

  it('shows the friendly error when the launch market read fails', async () => {
    (requireLaunchMarketId as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: 'permission denied for table markets',
    });
    (getSupabaseAdmin as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn() });
    render(await RestaurantsPage());
    expect(screen.getByText(RESTAURANTS_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(document.body.textContent).not.toContain('permission denied');
  });

  it('shows the empty state when no active restaurants come back', async () => {
    mockDirectory({ data: [], error: null });
    render(await RestaurantsPage());
    expect(screen.getByText(RESTAURANTS_EMPTY_MESSAGE)).toBeTruthy();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByText('Ada Grill')).toBeNull();
    expect(screen.getByText('0')).toBeTruthy();
  });
});
