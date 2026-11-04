import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PassportVisit } from '@/components/passport/passport-client';
import { PassportMapScreen } from '@/components/passport/passport-map-screen';
import { PassportMapMarkers } from '@/components/passport/passport-map-canvas';
import { cuisineInk, stampRotationDegrees } from '@/lib/passport/passport-board';
import { mapPoints, type PassportMapVisit } from '@/lib/passport/passport-map';
import type { VisitStatus } from '@/lib/visits/visit-status';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/share', () => ({
  shareOrCopy: vi.fn(async () => 'copied' as const),
}));

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

vi.mock('maplibre-gl', () => ({
  default: {},
}));

vi.mock('react-map-gl/maplibre', () => ({
  default: ({
    children,
    mapStyle,
  }: {
    children?: React.ReactNode;
    mapStyle?: { sources?: { osm?: { attribution?: string } } };
  }) => (
    <div data-testid="passport-map" data-attribution={mapStyle?.sources?.osm?.attribution ?? ''}>
      {children}
    </div>
  ),
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  NavigationControl: () => null,
  Popup: ({ children }: { children?: React.ReactNode }) => <div data-popup="">{children}</div>,
  Source: ({ id, data, children }: { id: string; data: unknown; children?: React.ReactNode }) => (
    <div data-source={id} data-geo={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Layer: ({ id }: { id: string }) => <div data-layer={id} />,
}));

const NORTH = '11111111-1111-4111-8111-111111111111';
const SOUTH = '22222222-2222-4222-8222-222222222222';
const HIDDEN = '33333333-3333-4333-8333-333333333333';
const PENDING = '44444444-4444-4444-8444-444444444444';

function visit(input: {
  id: string;
  status: VisitStatus;
  name: string;
  verifiedAt?: string;
  lat?: number | null;
  lon?: number | null;
  neighborhood?: string | null;
  cuisine?: string[];
}): PassportVisit {
  return {
    id: input.id,
    verifiedAt: input.verifiedAt ?? '',
    visitStatus: input.status,
    redemptionStatus: input.status === 'code_issued' ? 'issued' : 'verified',
    restaurant: {
      id: `rest-${input.id}`,
      name: input.name,
      address: null,
      lat: input.lat ?? null,
      lon: input.lon ?? null,
      cuisine_tags: input.cuisine ?? [],
      neighborhood: input.neighborhood ?? null,
      image_url: null,
      google_place_id: null,
    },
  };
}

const acceptanceVisits = [
  visit({
    id: NORTH,
    status: 'verified',
    name: 'North Grill',
    verifiedAt: '2026-04-26T18:00:00.000Z',
    lat: 33.2,
    lon: -96.61,
    neighborhood: 'Downtown',
    cuisine: ['Pizza'],
  }),
  visit({
    id: SOUTH,
    status: 'note_added',
    name: 'South Grill',
    verifiedAt: '2026-11-01T04:30:00.000Z',
    lat: 33.16,
    lon: -96.7,
    neighborhood: 'Stonebridge',
    cuisine: ['Sushi'],
  }),
  visit({
    id: HIDDEN,
    status: 'verified',
    name: 'Hidden Grill',
    verifiedAt: '2026-08-15T18:00:00.000Z',
    neighborhood: 'Downtown',
  }),
  visit({
    id: PENDING,
    status: 'code_issued',
    name: 'Zen Sushi',
    lat: 33.3,
    lon: -96.5,
    neighborhood: 'Craig Ranch',
    cuisine: ['Sushi'],
  }),
];

const baseProps = {
  userDisplayName: 'Noah',
  ratingsByRestaurantId: {},
  biteNotesByRestaurantId: {},
  currentStreak: 2,
  longestStreak: 2,
  totalMonthsActive: 2,
  uniqueRestaurants: 3,
  neighborhoods: 2,
  partnerNeighborhoods: 4,
  verifiedVisits: 3,
  pendingVisits: 1,
  earnedBadges: [] as { id: string; name: string; earnedOn: string | null }[],
  showFirstBiteLocked: false,
};

describe('passport map segment', () => {
  afterEach(() => {
    cleanup();
  });

  it('selects a stamp pin and draws the Chicago route', () => {
    const points = mapPoints(acceptanceVisits as PassportMapVisit[]);
    render(<PassportMapMarkers points={points} mapLib={{}} />);
    expect(screen.getByTestId('passport-map').getAttribute('data-attribution')).toContain('OpenStreetMap');
    expect(screen.getAllByRole('button', { name: /Grill/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Zen Sushi/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Hidden Grill/ })).toBeNull();

    const north = screen.getByRole('button', { name: /North Grill/ });
    const stamp = north.querySelector('[data-ink]');
    expect(stamp?.getAttribute('data-ink')).toBe(cuisineInk(['Pizza']).color);
    expect(stamp?.getAttribute('data-rotation')).toBe(String(stampRotationDegrees(NORTH)));
    expect(north.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(north);
    expect(north.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /South Grill/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('North Grill')).toBeTruthy();

    const route = document.querySelector('[data-source="passport-route"]');
    const geo = JSON.parse(route?.getAttribute('data-geo') ?? '{}') as {
      geometry?: { coordinates?: [number, number][] };
    };
    expect(geo.geometry?.coordinates).toEqual([
      [-96.61, 33.2],
      [-96.7, 33.16],
    ]);
    expect(document.querySelector('[data-layer="passport-fog-fill"]')).toBeTruthy();
    expect(document.querySelector('[data-layer="passport-neighborhood-glow"]')).toBeTruthy();
    expect(document.querySelector('[data-layer="passport-visit-clearing"]')).toBeTruthy();
    expect(document.querySelector('[data-map-fog]')?.getAttribute('data-map-fog')).toBe('static');
  });

  it('lists a visit without coordinates and keeps the progress neighborhood count', () => {
    render(<PassportMapScreen {...baseProps} segment="map" visits={acceptanceVisits} />);
    expect(screen.getByRole('radio', { name: 'Map' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('2 of 4 McKinney neighborhoods explored')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Not on the map yet' })).toBeTruthy();
    expect(screen.getByText('Hidden Grill')).toBeTruthy();
    expect(screen.queryByText('Zen Sushi')).toBeNull();
    const route = [...document.querySelectorAll('[data-route-order] li')].map((node) => node.textContent);
    expect(route).toEqual(['North Grill', 'South Grill']);
  });

  it('shows the passport error instead of a zero neighborhood counter', () => {
    render(
      <PassportMapScreen
        {...baseProps}
        segment="map"
        visits={[]}
        progressUnavailable
        neighborhoods={0}
        partnerNeighborhoods={4}
        verifiedVisits={0}
        pendingVisits={0}
        uniqueRestaurants={0}
        currentStreak={0}
        longestStreak={0}
      />,
    );
    expect(screen.getByText('Passport temporarily unavailable')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retry' }).getAttribute('href')).toBe('/journey?view=map');
    expect(screen.queryByText(/neighborhoods explored/)).toBeNull();
    expect(screen.queryByText('0 of 4')).toBeNull();
  });

  it('shows an empty map state when there are no stamp visits', () => {
    render(
      <PassportMapScreen
        {...baseProps}
        segment="map"
        visits={[acceptanceVisits[3]!]}
        neighborhoods={0}
        verifiedVisits={0}
        pendingVisits={1}
        uniqueRestaurants={0}
      />,
    );
    expect(screen.getByText(/visit shows up on the map after it is verified/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Not on the map yet' })).toBeNull();
    expect(screen.queryByText('Zen Sushi')).toBeNull();
    expect(screen.getByText('0 of 4 McKinney neighborhoods explored')).toBeTruthy();
  });

  it('keeps the map fog still under reduced motion', () => {
    const css = readFileSync(
      path.join(path.resolve(__dirname, '../../..'), 'src/app/styles/wanderbite-theme.css'),
      'utf8',
    );
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.wb-map-frame');
  });
});
