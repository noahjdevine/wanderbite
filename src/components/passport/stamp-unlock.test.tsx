import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassportClient, type PassportVisit } from '@/components/passport/passport-client';
import { SEEN_STAMPS_STORAGE_KEY } from '@/lib/passport/stamp-unlock';
import type { VisitStatus } from '@/lib/visits/visit-status';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/app/actions/bite-notes', () => ({
  toggleNoteVisibility: vi.fn(async () => ({ ok: true })),
  getPublicReviews: vi.fn(async () => ({ ok: true, data: [] })),
  getBiteNotes: vi.fn(async () => ({ ok: true, data: [] })),
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

vi.mock('@/lib/share', () => ({
  shareOrCopy: vi.fn(async () => 'copied' as const),
}));

const baseProps = {
  userDisplayName: 'Noah',
  ratingsByRestaurantId: {},
  biteNotesByRestaurantId: {},
  currentStreak: 1,
  longestStreak: 1,
  totalMonthsActive: 1,
  uniqueRestaurants: 1,
  neighborhoods: 1,
  verifiedVisits: 1,
  pendingVisits: 0,
  earnedBadges: [] as { id: string; name: string; earnedOn: string | null }[],
  showFirstBiteLocked: false,
  pageYear: '2026',
};

function visit(input: {
  id: string;
  name: string;
  status: VisitStatus;
  verifiedAt: string;
}): PassportVisit {
  return {
    id: input.id,
    verifiedAt: input.verifiedAt,
    visitStatus: input.status,
    redemptionStatus: input.status === 'code_issued' ? 'issued' : 'verified',
    restaurant: {
      id: `rest-${input.id}`,
      name: input.name,
      address: null,
      lat: null,
      lon: null,
      cuisine_tags: ['Pizza'],
      neighborhood: 'Downtown',
      image_url: null,
      google_place_id: null,
    },
  };
}

function storedIds(): string[] {
  const raw = window.localStorage.getItem(SEEN_STAMPS_STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { ids: string[] };
  return parsed.ids;
}

function stubMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

describe('passport stamp unlock', () => {
  beforeEach(() => {
    window.localStorage.clear();
    stubMotion(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function flushPaint() {
    await waitFor(() => {
      expect(window.localStorage.getItem(SEEN_STAMPS_STORAGE_KEY)).toBeTruthy();
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  it('slams a new verified stamp once and announces it', async () => {
    const recent = new Date().toISOString();
    const { unmount } = render(
      <PassportClient
        {...baseProps}
        visits={[visit({ id: 'red-new', name: 'North Grill', status: 'verified', verifiedAt: recent })]}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /North Grill/ }).className).toContain('wb-stamp-slam');
    });
    expect(document.querySelectorAll('.wb-stamp-slam')).toHaveLength(1);
    expect(document.querySelector('[data-stamp-burst]')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('New stamp: North Grill')).toBeTruthy();
    expect(storedIds()).toEqual(['red-new']);
    await flushPaint();
    unmount();

    render(
      <PassportClient
        {...baseProps}
        visits={[visit({ id: 'red-new', name: 'North Grill', status: 'verified', verifiedAt: recent })]}
      />,
    );
    await flushPaint();
    expect(document.querySelector('.wb-stamp-slam')).toBeNull();
    expect(document.querySelector('[data-stamp-burst]')).toBeNull();
    expect(screen.getByRole('button', { name: /North Grill/ })).toBeTruthy();
  });

  it('slams only the newest of three unseen stamps', async () => {
    const now = Date.now();
    render(
      <PassportClient
        {...baseProps}
        verifiedVisits={3}
        visits={[
          visit({
            id: 'newest',
            name: 'Newest Grill',
            status: 'note_added',
            verifiedAt: new Date(now - 60_000).toISOString(),
          }),
          visit({
            id: 'middle',
            name: 'Middle Grill',
            status: 'verified',
            verifiedAt: new Date(now - 3_600_000).toISOString(),
          }),
          visit({
            id: 'older',
            name: 'Older Grill',
            status: 'verified',
            verifiedAt: new Date(now - 7_200_000).toISOString(),
          }),
        ]}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Newest Grill/ }).className).toContain('wb-stamp-slam');
    });
    expect(screen.getByRole('button', { name: /Middle Grill/ }).className).not.toContain('wb-stamp-slam');
    expect(screen.getByRole('button', { name: /Older Grill/ }).className).not.toContain('wb-stamp-slam');
    expect(document.querySelectorAll('.wb-stamp-slam')).toHaveLength(1);
    expect(storedIds().sort()).toEqual(['middle', 'newest', 'older']);
    expect(screen.getByText('New stamp: Newest Grill')).toBeTruthy();
  });

  it('does not animate or store a pending stamp', async () => {
    render(
      <PassportClient
        {...baseProps}
        verifiedVisits={0}
        pendingVisits={1}
        visits={[
          visit({
            id: 'pending',
            name: 'Zen Sushi',
            status: 'code_issued',
            verifiedAt: '',
          }),
        ]}
      />,
    );
    await waitFor(() => {
      expect(window.localStorage.getItem(SEEN_STAMPS_STORAGE_KEY)).toBeTruthy();
    });
    expect(screen.getByRole('img', { name: /Zen Sushi, pending/ })).toBeTruthy();
    expect(document.querySelector('.wb-stamp-slam')).toBeNull();
    expect(storedIds()).not.toContain('pending');
    expect(screen.queryByText(/New stamp:/)).toBeNull();
  });

  it('stays at rest and still marks the stamp seen when motion is reduced', async () => {
    stubMotion(true);
    const recent = new Date().toISOString();
    render(
      <PassportClient
        {...baseProps}
        visits={[visit({ id: 'red-new', name: 'North Grill', status: 'verified', verifiedAt: recent })]}
      />,
    );
    await waitFor(() => {
      expect(storedIds()).toEqual(['red-new']);
    });
    expect(document.querySelector('.wb-stamp-slam')).toBeNull();
    expect(document.querySelector('[data-stamp-burst]')).toBeNull();
    expect(screen.getByRole('button', { name: /North Grill/ })).toBeTruthy();
    expect(screen.getByText('New stamp: North Grill')).toBeTruthy();
  });

  it('does not slam old stamps on the first run', async () => {
    render(
      <PassportClient
        {...baseProps}
        visits={[
          visit({
            id: 'old',
            name: 'Old Grill',
            status: 'verified',
            verifiedAt: '2026-04-26T18:00:00.000Z',
          }),
        ]}
      />,
    );
    await waitFor(() => {
      expect(storedIds()).toEqual(['old']);
    });
    expect(document.querySelector('.wb-stamp-slam')).toBeNull();
    expect(screen.queryByText('New stamp: Old Grill')).toBeNull();
  });

  it('renders the page with no slam when storage is junk or throws', async () => {
    window.localStorage.setItem(SEEN_STAMPS_STORAGE_KEY, '{');
    const recent = new Date().toISOString();
    const { unmount } = render(
      <PassportClient
        {...baseProps}
        visits={[visit({ id: 'red-new', name: 'North Grill', status: 'verified', verifiedAt: recent })]}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /North Grill/ })).toBeTruthy();
    });
    expect(document.querySelector('.wb-stamp-slam')).toBeNull();
    expect(window.localStorage.getItem(SEEN_STAMPS_STORAGE_KEY)).toBe('{');
    unmount();

    const proto = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    expect(() =>
      render(
        <PassportClient
          {...baseProps}
          visits={[visit({ id: 'red-new', name: 'North Grill', status: 'verified', verifiedAt: recent })]}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByRole('button', { name: /North Grill/ })).toBeTruthy();
    expect(document.querySelector('.wb-stamp-slam')).toBeNull();
    if (proto) Object.defineProperty(window, 'localStorage', proto);
  });
});
