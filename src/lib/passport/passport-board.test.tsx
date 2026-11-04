import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassportMemoryCard } from '@/components/passport/passport-memory';
import { PassportSegments } from '@/components/passport/passport-segments';
import { PassportClient, type PassportVisit } from '@/components/passport/passport-client';
import {
  allCuisineInkColors,
  buildPassportShare,
  chicagoVisitDate,
  cuisineInk,
  FALLBACK_CUISINE_INK,
  offerPublicToggle,
  segmentForJourneyView,
  segmentHref,
  stampKind,
  stampRotationDegrees,
} from '@/lib/passport/passport-board';
import { parseMyJourneyView } from '@/lib/my-journey-views';
import type { VisitStatus } from '@/lib/visits/visit-status';

const push = vi.hoisted(() => vi.fn());
const toggleNoteVisibility = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/app/actions/bite-notes', () => ({
  toggleNoteVisibility,
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

const STATUSES: VisitStatus[] = [
  'ready',
  'code_issued',
  'code_expired',
  'verified',
  'note_added',
  'expired',
  'swapped',
];

function contrast(hex: string, background = '#ffffff'): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = (color: string) => {
    const n = color.replace('#', '');
    const r = Number.parseInt(n.slice(0, 2), 16);
    const g = Number.parseInt(n.slice(2, 4), 16);
    const b = Number.parseInt(n.slice(4, 6), 16);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const lighter = Math.max(lum(hex), lum(background));
  const darker = Math.min(lum(hex), lum(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function visit(id: string, status: VisitStatus, name: string, cuisine: string[] = []): PassportVisit {
  return {
    id,
    verifiedAt: status === 'verified' || status === 'note_added' ? '2026-11-01T04:30:00.000Z' : '',
    visitStatus: status,
    redemptionStatus: status === 'verified' || status === 'note_added' ? 'verified' : 'issued',
    restaurant: {
      id: `rest-${id}`,
      name,
      address: null,
      lat: null,
      lon: null,
      cuisine_tags: cuisine,
      neighborhood: 'Downtown',
      image_url: null,
      google_place_id: null,
    },
  };
}

const baseProps = {
  userDisplayName: 'Noah',
  ratingsByRestaurantId: {},
  biteNotesByRestaurantId: {},
  currentStreak: 2,
  longestStreak: 2,
  totalMonthsActive: 2,
  uniqueRestaurants: 2,
  neighborhoods: 1,
  verifiedVisits: 2,
  pendingVisits: 1,
  earnedBadges: [] as { id: string; name: string; earnedOn: string | null }[],
  showFirstBiteLocked: false,
  pageYear: '2026',
};

describe('passport board', () => {
  afterEach(() => {
    cleanup();
    push.mockClear();
    toggleNoteVisibility.mockClear();
  });

  it('maps statuses to stamp, pending, or nothing', () => {
    expect(STATUSES.map((status) => [status, stampKind(status)])).toEqual([
      ['ready', 'none'],
      ['code_issued', 'pending'],
      ['code_expired', 'none'],
      ['verified', 'stamp'],
      ['note_added', 'stamp'],
      ['expired', 'none'],
      ['swapped', 'none'],
    ]);
  });

  it('rotates from the redemption id inside -8 to 6 degrees', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const first = stampRotationDegrees(id);
    expect(stampRotationDegrees(id)).toBe(first);
    expect(first).toBeGreaterThanOrEqual(-8);
    expect(first).toBeLessThanOrEqual(6);
    expect(Number.isInteger(first)).toBe(true);
    expect(stampRotationDegrees('33333333-3333-4333-8333-333333333333')).toBe(
      stampRotationDegrees('33333333-3333-4333-8333-333333333333'),
    );
  });

  it('maps cuisine ink, including an unknown tag, and keeps contrast', () => {
    expect(cuisineInk(['Pizza']).color).toBe('#c2410c');
    expect(cuisineInk(['Japanese']).color).toBe('#0f766e');
    expect(cuisineInk(['bar']).key).toBe('american');
    expect(cuisineInk(['not-a-cuisine'])).toEqual(FALLBACK_CUISINE_INK);
    expect(cuisineInk([])).toEqual(FALLBACK_CUISINE_INK);
    expect(cuisineInk(null)).toEqual(FALLBACK_CUISINE_INK);
    expect(cuisineInk(['bar', 'pizza']).key).toBe('american');
    for (const color of allCuisineInkColors()) {
      expect(contrast(color)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color, '#fffdf8')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps a Chicago October 31 visit in October under any process zone', () => {
    const parts = chicagoVisitDate('2026-11-01T04:30:00.000Z');
    expect(parts?.month).toBe('October');
    expect(parts?.short).toBe('Oct 31');
    expect(parts?.long).toBe('October 31, 2026');
    expect(parts?.year).toBe('2026');
  });

  it('keeps parseMyJourneyView and maps segments onto the same URLs', () => {
    expect(parseMyJourneyView(undefined)).toBe('journey');
    expect(parseMyJourneyView('journey')).toBe('journey');
    expect(parseMyJourneyView('journal')).toBe('journal');
    expect(parseMyJourneyView('passport')).toBe('passport');
    expect(parseMyJourneyView('progress')).toBe('journey');
    expect(segmentForJourneyView('passport')).toBe('stamps');
    expect(segmentForJourneyView('journal')).toBe('timeline');
    expect(segmentForJourneyView('journey')).toBeNull();
    expect(segmentHref('stamps')).toBe('/journey?view=passport');
    expect(segmentHref('timeline')).toBe('/journey?view=journal');
    expect(segmentHref('map')).toBeNull();
  });

  it('offers public only for a verified redemption with verified_at', () => {
    expect(offerPublicToggle({ redemptionStatus: 'verified', verifiedAt: '2026-10-31T04:30:00.000Z' })).toBe(
      true,
    );
    expect(offerPublicToggle({ redemptionStatus: 'verified', verifiedAt: null })).toBe(false);
    expect(offerPublicToggle({ redemptionStatus: 'verified', verifiedAt: '' })).toBe(false);
    expect(offerPublicToggle({ redemptionStatus: 'issued', verifiedAt: null })).toBe(false);
    expect(offerPublicToggle({ redemptionStatus: 'expired', verifiedAt: '2026-10-31T04:30:00.000Z' })).toBe(
      false,
    );
  });

  it('shares wanderbite.co counts and drops notes, email, and codes', () => {
    const payload = buildPassportShare({
      progressUnavailable: false,
      uniqueRestaurants: 2,
      neighborhoods: 1,
      currentStreak: 2,
      privateNotes: ['secret supper on the patio'],
      email: 'noah@example.com',
      redemptionCodes: ['WB-12345'],
    });
    expect(payload).toEqual({
      title: 'My Wanderbite Food Passport',
      text: "I've explored 2 restaurants across 1 neighborhood with Wanderbite 🍽️🔥 2 months streak and counting.",
      url: 'https://wanderbite.co',
    });
    const blob = JSON.stringify(payload);
    expect(blob).not.toContain('secret supper');
    expect(blob).not.toContain('noah@example.com');
    expect(blob).not.toContain('WB-12345');
    expect(buildPassportShare({
      progressUnavailable: true,
      uniqueRestaurants: 0,
      neighborhoods: 0,
      currentStreak: 0,
      email: 'noah@example.com',
    }).text).toBe('My Wanderbite Food Passport');
  });

  it('renders two stamps, one pending stamp, and no expired code', () => {
    render(
      <PassportClient
        {...baseProps}
        visits={[
          visit('11111111-1111-4111-8111-111111111111', 'verified', 'North Grill', ['Pizza']),
          visit('22222222-2222-4222-8222-222222222222', 'note_added', 'South Grill', ['Sushi']),
          visit('33333333-3333-4333-8333-333333333333', 'code_issued', 'Zen Sushi', ['Sushi']),
          visit('44444444-4444-4444-8444-444444444444', 'code_expired', 'Old Code Grill'),
          visit('55555555-5555-4555-8555-555555555555', 'ready', 'Ready Grill'),
          visit('66666666-6666-4666-8666-666666666666', 'expired', 'Closed Grill'),
          visit('77777777-7777-4777-8777-777777777777', 'swapped', 'Swapped Grill'),
        ]}
      />,
    );
    expect(screen.getAllByRole('button', { name: /Grill/ })).toHaveLength(2);
    expect(screen.getByRole('img', { name: /Zen Sushi, pending/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Old Code Grill/ })).toBeNull();
    expect(screen.queryByText('Old Code Grill')).toBeNull();
    expect(screen.queryByText('Ready Grill')).toBeNull();
    expect(screen.queryByText('Closed Grill')).toBeNull();
    expect(screen.queryByText('Swapped Grill')).toBeNull();
    expect(screen.getByText('2 visits').closest('[data-passport-visits]')?.getAttribute('data-passport-visits')).toBe(
      '2',
    );
    const north = screen.getByRole('button', { name: /North Grill/ });
    expect(north.getAttribute('aria-label')).toContain('October 31, 2026');
    expect(north.getAttribute('aria-label')).toContain('Verified');
    expect(north.tagName).toBe('BUTTON');
    fireEvent.click(screen.getByRole('button', { name: /South Grill/ }));
    expect(screen.getByRole('heading', { name: 'South Grill' })).toBeTruthy();
  });

  it('shows an empty passport without sample restaurants', () => {
    render(
      <PassportClient
        {...baseProps}
        visits={[]}
        verifiedVisits={0}
        pendingVisits={0}
        uniqueRestaurants={0}
        neighborhoods={0}
        currentStreak={0}
        longestStreak={0}
      />,
    );
    expect(screen.getByText(/Your passport is empty/)).toBeTruthy();
    expect(screen.queryByText('Cadillac Pizza Pub')).toBeNull();
    expect(screen.queryByText('The Yard')).toBeNull();
    expect(screen.getByRole('link', { name: /Next stamp/ }).getAttribute('href')).toBe('/challenges');
  });

  it('shows the passport error instead of zero counts', () => {
    render(
      <PassportClient
        {...baseProps}
        visits={[]}
        progressUnavailable
        verifiedVisits={0}
        pendingVisits={0}
        uniqueRestaurants={0}
        neighborhoods={0}
        currentStreak={0}
        longestStreak={0}
      />,
    );
    expect(screen.getByText('Passport temporarily unavailable')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retry' }).getAttribute('href')).toBe('/journey?view=passport');
    expect(screen.queryByText('0 visits')).toBeNull();
    expect(screen.queryByText('0 restaurants')).toBeNull();
    expect(screen.queryByText('0 months streak')).toBeNull();
  });

  it('links Stamps and Timeline and leaves Map closed', () => {
    render(<PassportSegments active="stamps" />);
    expect(screen.getByRole('radio', { name: 'Stamps' }).getAttribute('href')).toBe('/journey?view=passport');
    expect(screen.getByRole('radio', { name: 'Timeline' }).getAttribute('href')).toBe('/journey?view=journal');
    const map = screen.getByRole('radio', { name: 'Map, coming later' });
    expect(map.getAttribute('aria-disabled')).toBe('true');
    expect(map.getAttribute('href')).toBeNull();
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'Passport views' }), { key: 'ArrowRight' });
    expect(push).toHaveBeenCalledWith('/journey?view=journal');
  });

  it('does not offer Public on an unverified memory and toggles a verified one', async () => {
    const { rerender } = render(
      <PassportMemoryCard
        name="Issued Grill"
        meta="Code issued"
        note="Not yet"
        rating={3}
        photoLabel="Restaurant photo"
        restaurantId="rest-issued"
        imageUrl={null}
        googlePlaceId={null}
        redemptionId="44444444-4444-4444-8444-444444444444"
        status="code_issued"
        noteId="note-issued"
        isPublic={false}
        redemptionStatus="issued"
        verifiedAt={null}
      />,
    );
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText('Make public')).toBeNull();

    rerender(
      <PassportMemoryCard
        name="North Grill"
        meta="October 31, 2026"
        note="Quiet booth"
        rating={4}
        photoLabel="Restaurant photo"
        restaurantId="rest-1"
        imageUrl={null}
        googlePlaceId={null}
        redemptionId="11111111-1111-4111-8111-111111111111"
        status="note_added"
        noteId="note-1"
        isPublic={false}
        redemptionStatus="verified"
        verifiedAt="2026-11-01T04:30:00.000Z"
      />,
    );
    expect(screen.getByText('Private')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: /Private/ }));
    expect(toggleNoteVisibility).toHaveBeenCalledWith('note-1', true);
    expect(await screen.findByText('Public')).toBeTruthy();
  });
});
