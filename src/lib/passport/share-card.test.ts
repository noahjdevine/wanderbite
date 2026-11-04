import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { passportShareImageElement } from '@/lib/passport/share-card-image';
import { passportShareSourceFromRows } from '@/lib/passport/load-share-card';
import {
  buildPassportShareCard,
  PASSPORT_SHARE_STAMP_CAP,
  passportShareCardTitle,
  type PassportShareCardSource,
  type PassportShareStampSource,
} from '@/lib/passport/share-card';

const NOTE = 'secret truffle note';
const EMAIL = 'noah@example.com';
const CODE = 'WB-9F3K';
const REDEMPTION_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const EXACT = '2026-11-01T04:30:00.000Z';

function stamp(overrides: Partial<PassportShareStampSource> & Pick<PassportShareStampSource, 'verifiedAt'>): PassportShareStampSource {
  return {
    restaurantName: 'Hutchins BBQ',
    neighborhood: 'Downtown',
    cuisineTags: ['bbq'],
    ...overrides,
  };
}

function source(overrides: Partial<PassportShareCardSource> = {}): PassportShareCardSource {
  return {
    displayName: 'Noah',
    progressUnavailable: false,
    verifiedVisits: 1,
    uniqueRestaurants: 1,
    neighborhoods: 1,
    currentStreak: 1,
    level: { level: 2, name: 'The Tastemaker' },
    earnedBadgeCount: 1,
    stamps: [stamp({ verifiedAt: EXACT })],
    ...overrides,
  };
}

function serialized(model: ReturnType<typeof buildPassportShareCard>): string {
  return `${JSON.stringify(model)}\n${renderToStaticMarkup(passportShareImageElement(model))}`;
}

describe('passport share card', () => {
  it('pluralizes visit, restaurant, and neighborhood counts at 0, 1, and 2', () => {
    for (const count of [0, 1, 2]) {
      const model = buildPassportShareCard(
        source({
          verifiedVisits: count,
          uniqueRestaurants: count,
          neighborhoods: count,
          currentStreak: count,
          stamps: [],
        }),
      );
      const noun = count === 1 ? '' : 's';
      expect(model.visitLabel).toBe(`${count} visit${noun}`);
      expect(model.restaurantLabel).toBe(`${count} restaurant${noun}`);
      expect(model.neighborhoodLabel).toBe(`${count} neighborhood${noun}`);
      expect(model.share.text).toContain(`${count} restaurant${noun}`);
      expect(model.share.text).toContain(`${count} neighborhood${noun}`);
      expect(model.share.text).toContain(`${count} month${noun}`);
      expect(model.share.url).toBe('https://wanderbite.co');
    }
  });

  it('keeps the six newest stamps and orders newest first', () => {
    const stamps = Array.from({ length: PASSPORT_SHARE_STAMP_CAP + 1 }, (_, index) =>
      stamp({
        restaurantName: `Place ${index}`,
        verifiedAt: `2026-01-${String(index + 1).padStart(2, '0')}T18:00:00.000Z`,
      }),
    );
    stamps.reverse();
    const model = buildPassportShareCard(source({ stamps }));
    expect(model.stamps).toHaveLength(PASSPORT_SHARE_STAMP_CAP);
    expect(model.stamps.map((entry) => entry.name)).toEqual([
      'Place 6',
      'Place 5',
      'Place 4',
      'Place 3',
      'Place 2',
      'Place 1',
    ]);
    expect(model.stamps[0]?.shape).toBe('rect');
    expect(model.stamps[1]?.shape).toBe('round');
    expect(model.empty).toBe(false);
  });

  it('uses My Passport when the member has no name', () => {
    for (const displayName of ['', '   ', 'Your', 'Welcome back', EMAIL]) {
      expect(passportShareCardTitle(displayName)).toBe('My Passport');
      const model = buildPassportShareCard(source({ displayName, stamps: [] }));
      expect(model.title).toBe('My Passport');
      expect(serialized(model)).not.toContain('Your Passport');
      expect(serialized(model)).not.toContain(EMAIL);
    }
    expect(buildPassportShareCard(source()).title).toBe("Noah's Passport");
  });

  it('omits level when none exists and shows the badge count', () => {
    const none = buildPassportShareCard(source({ level: null, earnedBadgeCount: 2 }));
    expect(none.levelLabel).toBeNull();
    expect(none.badgeLabel).toBe('2 badges');

    const one = buildPassportShareCard(source({ level: null, earnedBadgeCount: 1 }));
    expect(one.badgeLabel).toBe('1 badge');

    const zero = buildPassportShareCard(source({ level: null, earnedBadgeCount: 0 }));
    expect(zero.levelLabel).toBeNull();
    expect(zero.badgeLabel).toBeNull();

    const named = buildPassportShareCard(
      source({ level: { level: 0, name: 'Getting started' }, earnedBadgeCount: 2 }),
    );
    expect(named.levelLabel).toBe('Level 0 · Getting started');
    expect(named.badgeLabel).toBeNull();
  });

  it('prints the Chicago date for a visit that is still October in Chicago', () => {
    const model = buildPassportShareCard(source());
    expect(model.stamps[0]?.dateLabel).toBe('Oct 31');
    expect(serialized(model)).not.toContain(EXACT);
    expect(serialized(model)).not.toContain('04:30');
    expect(serialized(model)).not.toContain('11:30');
  });

  it('leaves an empty passport intact', () => {
    const model = buildPassportShareCard(
      source({
        verifiedVisits: 0,
        uniqueRestaurants: 0,
        neighborhoods: 0,
        currentStreak: 0,
        level: { level: 0, name: 'Getting started' },
        earnedBadgeCount: 0,
        stamps: [],
      }),
    );
    expect(model.empty).toBe(true);
    expect(model.stamps).toEqual([]);
    expect(serialized(model)).toContain('No stamps yet');
    expect(model.visitLabel).toBe('0 visits');
  });

  it('keeps notes, email, codes, ids, and exact timestamps off the card and the share text', () => {
    const model = buildPassportShareCard(
      source({
        email: EMAIL,
        userId: USER_ID,
        privateNotes: [NOTE],
        redemptionCodes: [CODE],
        redemptionIds: [REDEMPTION_ID],
        stamps: [
          stamp({
            verifiedAt: EXACT,
            note: NOTE,
            redemptionId: REDEMPTION_ID,
            userId: USER_ID,
            redemptionCode: CODE,
          }),
        ],
      }),
    );
    const text = serialized(model);
    for (const forbidden of [NOTE, EMAIL, CODE, REDEMPTION_ID, USER_ID, EXACT]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).toContain('Hutchins BBQ');
    expect(model.share.text).not.toContain(NOTE);
    expect(model.footer).toBe('wanderbite.co');
    expect(Object.keys(model.stamps[0] ?? {}).sort()).toEqual([
      'dateLabel',
      'inkColor',
      'inkLabel',
      'name',
      'neighborhood',
      'rotation',
      'shape',
    ]);
  });

  it('drops issued rows and private columns when building a source from redemptions', () => {
    const built = passportShareSourceFromRows({
      fullName: 'Noah Devine',
      now: new Date('2026-11-04T18:00:00.000Z'),
      rows: [
        {
          status: 'issued',
          verified_at: null,
          restaurant_id: 'rest-issued',
          restaurants: { name: 'Pending Place', cuisine_tags: ['pizza'], neighborhood: 'West' },
          encrypted_code: CODE,
          note: NOTE,
          user_id: USER_ID,
        },
        {
          status: 'verified',
          verified_at: EXACT,
          restaurant_id: 'rest-1',
          restaurants: { name: 'Hutchins BBQ', cuisine_tags: ['bbq'], neighborhood: ' Downtown ' },
          id: REDEMPTION_ID,
          user_id: USER_ID,
          token_hash: 'hash',
          encrypted_code: CODE,
          note: NOTE,
        },
      ],
    });
    expect(built.displayName).toBe('Noah');
    expect(built.verifiedVisits).toBe(1);
    expect(built.uniqueRestaurants).toBe(1);
    expect(built.neighborhoods).toBe(1);
    expect(built.stamps).toHaveLength(1);
    expect(built.stamps[0]?.restaurantName).toBe('Hutchins BBQ');
    expect(built.level).toEqual({ level: 0, name: 'Getting started' });
    const dumped = JSON.stringify(built);
    for (const forbidden of [NOTE, CODE, REDEMPTION_ID, USER_ID, 'Pending Place']) {
      expect(dumped).not.toContain(forbidden);
    }
    const model = buildPassportShareCard(built);
    expect(model.stamps[0]?.dateLabel).toBe('Oct 31');
  });

  it('uses My Passport when the profile name is blank', () => {
    const built = passportShareSourceFromRows({ fullName: null, rows: [] });
    expect(built.displayName).toBe('Your');
    expect(buildPassportShareCard(built).title).toBe('My Passport');
    expect(buildPassportShareCard(built).empty).toBe(true);
  });
});
