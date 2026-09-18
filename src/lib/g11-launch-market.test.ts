import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  pickDistinctRestaurants,
  restaurantsWithinMiles,
  selectDistancePool,
} from '@/lib/challenges/distance-pool';
import {
  AREA_HOLD_BODY,
  CHECKOUT_INELIGIBLE_MESSAGE,
  deriveDistanceMatch,
  distanceMatchCopy,
  haversineMiles,
  isLaunchEligibleAddress,
  isValidCoordinate,
  LAUNCH_MARKET,
  LAUNCH_ZIP_CODES,
  milesForDistanceBand,
  normalizeZip,
  originFromZip,
  parseDistanceBand,
  toGeoPoint,
} from '@/lib/launch-market';

const ROOT = path.resolve(__dirname, '../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function pointAtMiles(
  origin: { lat: number; lon: number },
  miles: number
): { lat: number; lon: number } {
  const earthMiles = 3958.7613;
  const lat =
    origin.lat + (miles / earthMiles) * (180 / Math.PI);
  return { lat, lon: origin.lon };
}

const ORIGIN = LAUNCH_MARKET.zipCentroids['75070'];

describe('G11 launch ZIP and address eligibility', () => {
  it.each(LAUNCH_ZIP_CODES)('accepts McKinney ZIP %s with TX', (zip) => {
    expect(normalizeZip(zip)).toBe(zip);
    expect(originFromZip(zip)).toEqual(LAUNCH_MARKET.zipCentroids[zip]);
    expect(isLaunchEligibleAddress({ state: 'TX', zip })).toBe(true);
    expect(isLaunchEligibleAddress({ state: 'tx', zip })).toBe(true);
  });

  it('parses ZIP+4 and trims, without scraping digits from arbitrary text', () => {
    expect(normalizeZip(' 75070-1234 ')).toBe('75070');
    expect(normalizeZip('75071')).toBe('75071');
    expect(normalizeZip('abc75070')).toBeNull();
    expect(normalizeZip('Call 75070 now')).toBeNull();
    expect(normalizeZip('7507')).toBeNull();
    expect(normalizeZip('750700')).toBeNull();
    expect(normalizeZip('')).toBeNull();
    expect(normalizeZip(null)).toBeNull();
  });

  it('rejects non-TX state and non-launch ZIPs', () => {
    expect(isLaunchEligibleAddress({ state: 'OK', zip: '75070' })).toBe(false);
    expect(isLaunchEligibleAddress({ state: 'Texas', zip: '75070' })).toBe(false);
    expect(isLaunchEligibleAddress({ state: 'TX', zip: '78731' })).toBe(false);
    expect(isLaunchEligibleAddress({ state: 'TX', zip: '75068' })).toBe(false);
    expect(CHECKOUT_INELIGIBLE_MESSAGE).toMatch(/not available at this address/i);
  });

  it('uses Census 2025 ZCTA centroids for the four launch ZIPs', () => {
    expect(LAUNCH_MARKET.zipCentroids).toEqual({
      '75069': { lat: 33.164077, lon: -96.595421 },
      '75070': { lat: 33.154678, lon: -96.696669 },
      '75071': { lat: 33.245816, lon: -96.63072 },
      '75072': { lat: 33.187899, lon: -96.699951 },
    });
    expect(LAUNCH_MARKET.slug).toBe('mckinney-tx');
    expect(LAUNCH_MARKET.displayName).toBe('McKinney, Texas');
  });

  it('fails closed on a null or invalid distance band', () => {
    expect(parseDistanceBand(null)).toBeNull();
    expect(parseDistanceBand('')).toBeNull();
    expect(parseDistanceBand('12_mi')).toBeNull();
    expect(parseDistanceBand('15_mi')).toBe('15_mi');
    expect(milesForDistanceBand('5_mi')).toBe(5);
  });
});

describe('G11 coordinates and derived distanceMatch', () => {
  it('excludes invalid coordinates from the pool', () => {
    const near = { id: 'near', lat: ORIGIN.lat, lon: ORIGIN.lon };
    const invalid = [
      { id: 'nulls', lat: null, lon: null },
      { id: 'nan', lat: Number.NaN, lon: ORIGIN.lon },
      { id: 'oob', lat: 99, lon: ORIGIN.lon },
    ];
    expect(isValidCoordinate(99, ORIGIN.lon)).toBe(false);
    expect(toGeoPoint(null, ORIGIN.lon)).toBeNull();
    const inRange = restaurantsWithinMiles([...invalid, near], ORIGIN, 5);
    expect(inRange.map((r) => r.id)).toEqual(['near']);
  });

  it('derives distanceMatch from current ZIP, band, and restaurant coords', () => {
    const close = pointAtMiles(ORIGIN, 3);
    const farther = pointAtMiles(ORIGIN, 12);
    expect(haversineMiles(ORIGIN, close)).toBeLessThan(5);
    expect(haversineMiles(ORIGIN, farther)).toBeGreaterThan(5);

    const within = deriveDistanceMatch({
      zip: '75070',
      distanceBand: '5_mi',
      restaurants: [{ lat: close.lat, lon: close.lon }],
    });
    expect(within).toMatchObject({ requestedMiles: 5, expanded: false });
    expect(distanceMatchCopy(within!)).toBe(
      'Within about 5 miles of your ZIP area'
    );

    const expanded = deriveDistanceMatch({
      zip: '75070',
      distanceBand: '5_mi',
      restaurants: [
        { lat: close.lat, lon: close.lon },
        { lat: farther.lat, lon: farther.lon },
      ],
    });
    expect(expanded?.expanded).toBe(true);
    expect(distanceMatchCopy(expanded!)).toMatch(
      /^Expanded to about \d+ miles of your ZIP area$/
    );
  });
});

describe('G11 distance pool expansion', () => {
  const nearA = {
    id: 'near-a',
    lat: pointAtMiles(ORIGIN, 2).lat,
    lon: ORIGIN.lon,
    cuisine_tags: ['mexican'],
  };
  const nearB = {
    id: 'near-b',
    lat: pointAtMiles(ORIGIN, 3).lat,
    lon: ORIGIN.lon,
    cuisine_tags: ['italian'],
  };
  const far = {
    id: 'far',
    lat: pointAtMiles(ORIGIN, 12).lat,
    lon: ORIGIN.lon,
    cuisine_tags: ['thai'],
  };

  it('relaxes variety at the same radius before expanding', () => {
    const pool = selectDistancePool({
      restaurants: [nearA, nearB, far],
      origin: ORIGIN,
      requestedMiles: 5,
      requiredCount: 2,
      passesHard: () => true,
      passesVariety: () => false,
      passesRelaxedVariety: () => true,
    });
    expect(pool.match.expanded).toBe(false);
    expect(pool.candidates.map((r) => r.id).sort()).toEqual(['near-a', 'near-b']);
  });

  it('expands one band when generate needs 2 and the requested radius is thin', () => {
    const pool = selectDistancePool({
      restaurants: [nearA, far],
      origin: ORIGIN,
      requestedMiles: 5,
      requiredCount: 2,
      passesHard: () => true,
      passesVariety: () => true,
      passesRelaxedVariety: () => true,
    });
    expect(pool.match.expanded).toBe(true);
    expect(pool.match.usedMiles).toBe(15);
    expect(pool.candidates.map((r) => r.id).sort()).toEqual(['far', 'near-a']);
  });

  it('expands one band when swap needs 1 and the requested radius is empty', () => {
    const pool = selectDistancePool({
      restaurants: [far],
      origin: ORIGIN,
      requestedMiles: 5,
      requiredCount: 1,
      passesHard: () => true,
      passesVariety: () => true,
      passesRelaxedVariety: () => true,
    });
    expect(pool.match.expanded).toBe(true);
    expect(pool.candidates.map((r) => r.id)).toEqual(['far']);
  });

  it('keeps hard filters after expansion', () => {
    const pool = selectDistancePool({
      restaurants: [nearA, far],
      origin: ORIGIN,
      requestedMiles: 5,
      requiredCount: 2,
      passesHard: (restaurant) => restaurant.id !== 'far',
      passesVariety: () => true,
      passesRelaxedVariety: () => true,
    });
    expect(pool.candidates.map((r) => r.id)).toEqual(['near-a']);
    expect(pool.candidates.some((r) => r.id === 'far')).toBe(false);
  });

  it('still picks two restaurants from an all-cocktail pool', () => {
    const picked = pickDistinctRestaurants(
      [
        { id: 'c1', cuisine_tags: ['cocktail'] },
        { id: 'c2', cuisine_tags: ['bar'] },
        { id: 'c3', cuisine_tags: ['lounge'] },
      ],
      2,
      { reserveCocktail: true, shuffle: (items) => items }
    );
    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((r) => r.id)).size).toBe(2);
  });
});

describe('G11 wiring (source)', () => {
  it('resolves the launch market internally and checks eligibility before returning an existing cycle', () => {
    const generate = source('src/lib/challenges/generate.ts');
    const action = source('src/app/actions/generate-challenge.ts');
    expect(generate).toMatch(/export async function generateMonthlyChallengeForUser\(\s*userId: string/);
    expect(generate).toMatch(/requireLaunchMarketId/);
    expect(generate).toMatch(/selectDistancePool/);
    expect(generate).toMatch(/pickDistinctRestaurants/);
    expect(generate).toMatch(/deriveDistanceMatch/);
    expect(generate.indexOf('isLaunchEligibleAddress')).toBeLessThan(
      generate.indexOf('existingCycle')
    );
    expect(generate).toMatch(/'ineligible_address'/);
    expect(action).toMatch(/export async function generateMonthlyChallenge\(\): Promise/);
    expect(action).not.toMatch(/marketId/);
  });

  it('gates swaps at requiredCount 1 and skips ineligible cron users by reason', () => {
    const swap = source('src/app/actions/swap-challenge.ts');
    const cron = source('src/app/api/cron/issue-monthly-challenges/route.ts');
    expect(swap).toMatch(/requiredCount:\s*1/);
    expect(swap).toMatch(/isLaunchEligibleAddress/);
    expect(cron).toMatch(/result\.reason === 'ineligible_address'/);
    expect(cron).toMatch(/result\.reason === 'invalid_distance_preference'/);
    expect(cron).not.toMatch(/result\.error.*ineligible/);
    expect(cron).not.toMatch(/from\('markets'\)[\s\S]*limit\(1\)/);
  });

  it('filters Roulette and the directory by launch market id without exposing market_id on restaurants_public', () => {
    const roulette = source('src/app/api/roulette/route.ts');
    const directory = source('src/app/(site)/restaurants/page.tsx');
    const publicView = source('src/types/database.types.ts');
    const publicStart = publicView.indexOf('restaurants_public:');
    const publicEnd = publicView.indexOf('Relationships: []', publicStart);
    const publicBlock = publicView.slice(publicStart, publicEnd);
    expect(roulette).toMatch(/getSupabaseAdmin\(\)/);
    expect(roulette).toMatch(/requireLaunchMarketId/);
    expect(roulette).toMatch(/\.eq\('market_id', market\.marketId\)/);
    expect(roulette).toMatch(/LAUNCH_MARKET\.displayName/);
    expect(directory).toMatch(/requireLaunchMarketId/);
    expect(directory).toMatch(/\.eq\('market_id', market\.marketId\)/);
    expect(publicBlock).not.toMatch(/market_id/);
  });

  it('persists lat/lon on import and searches Google with one public argument', () => {
    const actions = source('src/app/(site)/admin/actions.ts');
    const importer = source('src/app/(site)/admin/actions-import.ts');
    const client = source('src/app/(site)/admin/admin-client.tsx');
    expect(actions).toMatch(/parseCoordinate/);
    expect(actions).toMatch(/getPlaceDetails/);
    expect(actions).toMatch(/\blat,\s*\n\s*lon,/);
    expect(importer).toMatch(
      /export async function searchRestaurantsFromGoogle\(\s*query: string\s*\)/
    );
    expect(client).toMatch(/searchRestaurantsFromGoogle\(q\)/);
    expect(client).not.toMatch(/importCityId/);
    expect(client).toMatch(/name="lat"/);
    expect(client).toMatch(/name="lon"/);
  });
});

describe('G11 copy and legal surfaces (source)', () => {
  const MARKETING = [
    'src/lib/club-plan-content.ts',
    'src/components/landing/landing-page.tsx',
    'src/components/landing/club-section.tsx',
    'src/components/landing/hero-slider.tsx',
    'src/components/dashboard/paywall-card.tsx',
    'src/components/pricing/pricing-client.tsx',
    'src/app/(site)/how-it-works/page.tsx',
    'src/components/journey/journey-content.tsx',
    'src/emails/subscription-confirmation.tsx',
    'src/emails/redemption-reminder.tsx',
    'src/app/(site)/success/page.tsx',
    'src/app/layout.tsx',
    'src/app/opengraph-image.tsx',
    'src/app/(site)/rules/page.tsx',
  ];

  const PERK_RES = [
    /Free App or Drink/i,
    /Free Dessert/i,
    /BOGO Entree/i,
    /Legend Swag/i,
    /automatic entry/i,
    /Gift Cards given away/i,
    /show your screen/i,
    /unlock more perks/i,
    /No expiration on unlocked rewards/i,
    /\$10 off \$40/i,
    /Get \$10 off at each spot/i,
  ];

  it('names McKinney before signup and uses variable offer copy', () => {
    expect(source('src/components/landing/hero-slider.tsx')).toMatch(
      /McKinney, Texas/
    );
    expect(source('src/components/landing/club-section.tsx')).toMatch(
      /McKinney, Texas/
    );
    expect(AREA_HOLD_BODY).toMatch(/McKinney, Texas/);
    expect(AREA_HOLD_BODY.toLowerCase()).toMatch(/not collecting/);
    for (const rel of MARKETING) {
      const src = source(rel);
      for (const re of PERK_RES) {
        expect(src, `${rel} matched ${re}`).not.toMatch(re);
      }
    }
    expect(source('src/lib/club-plan-content.ts')).toMatch(
      /discount and minimum spend|A discount on every assigned challenge/i
    );
  });

  it('keeps the Austin mailing address on Terms, Privacy, Rules, and Contact', () => {
    for (const rel of [
      'src/app/(site)/terms/page.tsx',
      'src/app/(site)/privacy/page.tsx',
      'src/app/(site)/rules/page.tsx',
      'src/app/(site)/contact/page.tsx',
    ]) {
      expect(source(rel), rel).toMatch(/5900 Balcones Drive/);
      expect(source(rel), rel).toMatch(/Austin, TX 78731/);
    }
  });

  it('does not collect a waitlist on the area-hold notice', () => {
    const notice = source('src/components/area-hold-notice.tsx');
    expect(notice).not.toMatch(/<form/i);
    expect(notice).not.toMatch(/type=["']email["']/);
    expect(notice).toMatch(/AREA_HOLD_HEADING/);
  });
});
