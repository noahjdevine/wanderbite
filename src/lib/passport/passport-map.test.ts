import { describe, expect, it } from 'vitest';
import { countDistinctNeighborhoods } from '@/lib/progress/neighborhoods';
import {
  chicagoCalendarKey,
  exploredNeighborhoodNames,
  exploredNeighborhoodsInPartnerSet,
  mapPoints,
  neighborhoodCounterLabel,
  neighborhoodGlowPoints,
  routeLine,
  routeStops,
  visitsNotOnMap,
  type PassportMapVisit,
} from '@/lib/passport/passport-map';
import type { VisitStatus } from '@/lib/visits/visit-status';

/**
 * Route order is America/Chicago calendar order.
 * These expectations must hold when the process TZ is UTC and when it is America/Chicago.
 * 2026-11-01T04:30:00.000Z is October 31 in Chicago and November 1 in UTC.
 */

function visit(input: {
  id: string;
  status: VisitStatus;
  verifiedAt?: string;
  name: string;
  lat?: number | null;
  lon?: number | null;
  neighborhood?: string | null;
  cuisine?: string[];
}): PassportMapVisit {
  return {
    id: input.id,
    verifiedAt: input.verifiedAt ?? '',
    visitStatus: input.status,
    restaurant: {
      name: input.name,
      lat: input.lat ?? null,
      lon: input.lon ?? null,
      neighborhood: input.neighborhood ?? null,
      cuisine_tags: input.cuisine ?? [],
    },
  };
}

const OCT_31 = '2026-11-01T04:30:00.000Z';
const NOV_1 = '2026-11-01T06:30:00.000Z';
const APRIL_25 = '2026-04-26T04:00:00.000Z';
const APRIL_26_EARLY = '2026-04-26T16:00:00.000Z';
const APRIL_26_LATE = '2026-04-26T20:00:00.000Z';

describe('passport map route order', () => {
  it('orders stops by Chicago date, then instant, in either process time zone', () => {
    expect(chicagoCalendarKey(OCT_31)).toBe('2026-10-31');
    expect(chicagoCalendarKey(NOV_1)).toBe('2026-11-01');
    expect(chicagoCalendarKey(APRIL_25)).toBe('2026-04-25');
    expect(OCT_31.slice(0, 10)).toBe('2026-11-01');
    expect(APRIL_25.slice(0, 10)).toBe('2026-04-26');

    const stops = routeStops([
      visit({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'verified',
        verifiedAt: NOV_1,
        name: 'Later',
        lat: 33.2,
        lon: -96.6,
      }),
      visit({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'note_added',
        verifiedAt: OCT_31,
        name: 'Earlier',
        lat: 33.1,
        lon: -96.7,
      }),
      visit({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        status: 'verified',
        verifiedAt: APRIL_26_LATE,
        name: 'April late',
        lat: 33.15,
        lon: -96.65,
      }),
      visit({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        status: 'verified',
        verifiedAt: APRIL_26_EARLY,
        name: 'April early',
        lat: 33.16,
        lon: -96.66,
      }),
      visit({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        status: 'verified',
        verifiedAt: APRIL_25,
        name: 'April 25',
        lat: 33.17,
        lon: -96.67,
      }),
      visit({
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        status: 'code_issued',
        name: 'Pending',
        lat: 33.3,
        lon: -96.5,
      }),
    ]);

    expect(stops.map((stop) => stop.restaurant.name)).toEqual([
      'April 25',
      'April early',
      'April late',
      'Earlier',
      'Later',
    ]);
    expect(stops.map((stop) => chicagoCalendarKey(stop.verifiedAt))).toEqual([
      '2026-04-25',
      '2026-04-26',
      '2026-04-26',
      '2026-10-31',
      '2026-11-01',
    ]);
    const line = routeLine(mapPoints(stops));
    expect(line?.geometry.coordinates).toEqual([
      [-96.67, 33.17],
      [-96.66, 33.16],
      [-96.65, 33.15],
      [-96.7, 33.1],
      [-96.6, 33.2],
    ]);
  });
});

describe('passport map pins and neighborhoods', () => {
  const withCoords = visit({
    id: '11111111-1111-4111-8111-111111111111',
    status: 'verified',
    verifiedAt: APRIL_26_EARLY,
    name: 'North Grill',
    lat: 33.2,
    lon: -96.6,
    neighborhood: ' Downtown ',
    cuisine: ['Pizza'],
  });
  const noted = visit({
    id: '22222222-2222-4222-8222-222222222222',
    status: 'note_added',
    verifiedAt: OCT_31,
    name: 'South Grill',
    lat: 33.15,
    lon: -96.7,
    neighborhood: 'Stonebridge',
    cuisine: ['Sushi'],
  });
  const missing = visit({
    id: '33333333-3333-4333-8333-333333333333',
    status: 'verified',
    verifiedAt: '2026-08-15T18:00:00.000Z',
    name: 'Hidden Grill',
    neighborhood: 'Adriatica',
  });
  const pending = visit({
    id: '44444444-4444-4444-8444-444444444444',
    status: 'code_issued',
    name: 'Zen Sushi',
    lat: 33.3,
    lon: -96.5,
    neighborhood: 'Craig Ranch',
  });
  const blank = visit({
    id: '55555555-5555-4555-8555-555555555555',
    status: 'verified',
    verifiedAt: '2026-07-01T18:00:00.000Z',
    name: 'Blank Grill',
    lat: 33.18,
    lon: -96.62,
    neighborhood: '   ',
  });

  const visits = [pending, missing, noted, withCoords, blank];

  it('pins only stamp visits that have coordinates', () => {
    const points = mapPoints(visits);
    expect(points.map((point) => point.name)).toEqual(['North Grill', 'Blank Grill', 'South Grill']);
    expect(points.find((point) => point.name === 'North Grill')).toMatchObject({
      latitude: 33.2,
      longitude: -96.6,
      cuisineTags: ['Pizza'],
      neighborhood: 'Downtown',
    });
    expect(visitsNotOnMap(visits).map((visit) => visit.restaurant.name)).toEqual(['Hidden Grill']);
    expect(routeLine([points[0]!])).toBeNull();
  });

  it('uses the shared neighborhood definition and clamps the counter at the partner set', () => {
    const names = exploredNeighborhoodNames(visits);
    expect(names).toEqual(['Adriatica', 'Stonebridge', 'Downtown']);
    expect(countDistinctNeighborhoods(names)).toBe(names.length);
    expect(neighborhoodGlowPoints(mapPoints(visits)).map((point) => point.neighborhood)).toEqual([
      'Downtown',
      'Stonebridge',
    ]);
    expect(neighborhoodCounterLabel(2, 4, 'McKinney')).toBe('2 of 4 McKinney neighborhoods explored');
    expect(neighborhoodCounterLabel(1, 1, 'McKinney')).toBe('1 of 1 McKinney neighborhood explored');
    expect(neighborhoodCounterLabel(5, 4, 'McKinney')).toBe('4 of 4 McKinney neighborhoods explored');
    expect(neighborhoodCounterLabel(0, 0, 'McKinney')).toBeNull();
    expect(neighborhoodCounterLabel(3, 0, 'McKinney')).toBeNull();
    expect(neighborhoodCounterLabel(null, 4, 'McKinney')).toBeNull();
    expect(neighborhoodCounterLabel(2, null, 'McKinney')).toBeNull();
  });

  it('counts stamp visits whose restaurant is still in the partner set', () => {
    const active = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const paused = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const visits = [
      {
        visitStatus: 'verified' as const,
        restaurant: { id: active, neighborhood: ' Downtown ' },
      },
      {
        visitStatus: 'note_added' as const,
        restaurant: { id: paused, neighborhood: 'West' },
      },
      {
        visitStatus: 'verified' as const,
        restaurant: { id: active, neighborhood: 'Downtown' },
      },
      {
        visitStatus: 'code_issued' as const,
        restaurant: { id: active, neighborhood: 'Craig Ranch' },
      },
    ];
    expect(exploredNeighborhoodsInPartnerSet(visits, [active])).toBe(1);
    expect(exploredNeighborhoodsInPartnerSet(visits, [active, paused])).toBe(2);
    expect(exploredNeighborhoodsInPartnerSet(visits, [])).toBe(0);
  });
});
