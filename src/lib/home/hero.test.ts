import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROULETTE_MAX_MESSAGE_CHARS } from '@/lib/ai-bounds';
import {
  CURATED_ADVENTURES_PER_MONTH,
  HERO_PLACEHOLDERS,
  PLACEHOLDER_CYCLE_MS,
  activeDirectoryRows,
  chooseHeroPick,
  curatedAdventuresFact,
  discoverHref,
  heroOfferLine,
  marketSealCity,
  nowCuratingLabel,
  parseDiscoverQuery,
  partnerNamesForMarquee,
  partnerSpotCount,
  partnerSpotLabel,
  placeholderDelaySeconds,
  placeholderIndex,
} from '@/lib/home/hero';

const root = path.resolve(__dirname, '../../..');

describe('placeholder cycle', () => {
  it('walks three prompts across a 12s loop', () => {
    expect(HERO_PLACEHOLDERS).toHaveLength(3);
    expect(PLACEHOLDER_CYCLE_MS).toBe(12_000);
    expect(placeholderIndex(0)).toBe(0);
    expect(placeholderIndex(3_999)).toBe(0);
    expect(placeholderIndex(4_000)).toBe(1);
    expect(placeholderIndex(7_999)).toBe(1);
    expect(placeholderIndex(8_000)).toBe(2);
    expect(placeholderIndex(11_999)).toBe(2);
    expect(placeholderIndex(12_000)).toBe(0);
    expect(placeholderIndex(-1)).toBe(2);
    expect(placeholderIndex(Number.NaN)).toBe(0);
  });

  it('staggers CSS delays by 4 seconds', () => {
    expect(placeholderDelaySeconds(0)).toBe(0);
    expect(placeholderDelaySeconds(1)).toBe(4);
    expect(placeholderDelaySeconds(2)).toBe(8);
  });
});

describe('partner directory filter', () => {
  const rows = [
    { status: 'active', name: 'The Yard' },
    { status: 'paused', name: 'Hidden Test Grill' },
    { status: 'active', name: '  ' },
    { status: 'active', name: 'Zen Sushi' },
    { status: 'active', name: 'zen sushi' },
    { status: null, name: 'No Status' },
    { status: 'active', name: ' Cadillac Pizza ' },
  ];

  it('counts only active named partners', () => {
    expect(partnerSpotCount(null)).toBeNull();
    expect(partnerSpotCount(rows)).toBe(4);
    expect(activeDirectoryRows(rows).map((row) => row.name.trim())).toEqual([
      'The Yard',
      'Zen Sushi',
      'zen sushi',
      'Cadillac Pizza',
    ]);
    expect(partnerSpotLabel(1)).toBe('local partner spot');
    expect(partnerSpotLabel(0)).toBe('local partner spots');
    expect(partnerSpotLabel(4)).toBe('local partner spots');
  });

  it('hides the marquee under 3 unique names and drops paused rows', () => {
    expect(partnerNamesForMarquee(null)).toBeNull();
    expect(partnerNamesForMarquee([{ status: 'active', name: 'Only One' }])).toBeNull();
    expect(
      partnerNamesForMarquee([
        { status: 'active', name: 'A' },
        { status: 'paused', name: 'Hidden Test Grill' },
        { status: 'active', name: 'B' },
      ]),
    ).toBeNull();
    expect(partnerNamesForMarquee(rows)).toEqual(['The Yard', 'Zen Sushi', 'Cadillac Pizza']);
  });

  it('uses the same active launch-market filters as the restaurant directory', () => {
    const catalog = readFileSync(path.join(root, 'src/lib/home/hero-catalog.ts'), 'utf8');
    const directory = readFileSync(path.join(root, 'src/app/(site)/restaurants/page.tsx'), 'utf8');
    expect(catalog).toMatch(/\.eq\('status', 'active'\)/);
    expect(catalog).toMatch(/\.eq\('market_id', market\.marketId\)/);
    expect(catalog).toMatch(/requireLaunchMarketId/);
    expect(directory).toMatch(/\.eq\('status', 'active'\)/);
    expect(directory).toMatch(/\.eq\('market_id', market\.marketId\)/);
    expect(catalog).toMatch(/isTestOfferAuditMarker/);
  });
});

describe('hero offer line', () => {
  it('formats a real selectable offer and refuses a test or unselectable one', () => {
    expect(
      heroOfferLine({
        discountCents: 1000,
        minSpendCents: 4000,
        isTestOffer: false,
        selectable: true,
      }),
    ).toBe('$10 off when you spend $40+');
    expect(
      heroOfferLine({
        discountCents: 1000,
        minSpendCents: 4000,
        isTestOffer: true,
        selectable: true,
      }),
    ).toBeNull();
    expect(
      heroOfferLine({
        discountCents: 1000,
        minSpendCents: 4000,
        isTestOffer: false,
        selectable: false,
      }),
    ).toBeNull();
    expect(
      heroOfferLine({
        discountCents: 0,
        minSpendCents: 4000,
        isTestOffer: false,
        selectable: true,
      }),
    ).toBeNull();
  });
});

describe('chooseHeroPick', () => {
  it('prefers a real offer, otherwise a named partner, otherwise a sample', () => {
    expect(chooseHeroPick([])).toEqual({ kind: 'sample' });
    expect(
      chooseHeroPick([{ id: 'a', name: '  ', cuisine: null, offerLabel: '$10 off when you spend $40+' }]),
    ).toEqual({ kind: 'sample' });
    expect(
      chooseHeroPick([
        { id: 'a', name: 'The Yard', cuisine: 'American', offerLabel: null },
        { id: 'b', name: 'Umai', cuisine: 'Japanese', offerLabel: '$10 off when you spend $40+' },
      ]),
    ).toEqual({
      kind: 'partner',
      id: 'b',
      name: 'Umai',
      cuisine: 'Japanese',
      offerLabel: '$10 off when you spend $40+',
    });
    expect(
      chooseHeroPick([{ id: 'a', name: 'The Yard', cuisine: null, offerLabel: null }]),
    ).toEqual({
      kind: 'partner',
      id: 'a',
      name: 'The Yard',
      cuisine: null,
      offerLabel: null,
    });
  });
});

describe('parseDiscoverQuery', () => {
  it('reads the first q value and caps it at the Discover limit', () => {
    expect(parseDiscoverQuery(undefined)).toBe('');
    expect(parseDiscoverQuery(null)).toBe('');
    expect(parseDiscoverQuery('   ')).toBe('');
    expect(parseDiscoverQuery([' spicy noodles ', 'ignored'])).toBe('spicy noodles');
    expect(parseDiscoverQuery('spicy noodles')).toBe('spicy noodles');
    const max = 'a'.repeat(ROULETTE_MAX_MESSAGE_CHARS);
    expect(parseDiscoverQuery(max)).toBe(max);
    expect(parseDiscoverQuery(`${max}ZZ`)).toBe(max);
    expect(discoverHref('spicy noodles')).toBe('/roulette?q=spicy%20noodles');
    expect(discoverHref('   ')).toBe('/roulette');
  });
});

describe('market copy and the monthly adventure count', () => {
  it('reads McKinney from the launch city query', () => {
    expect(nowCuratingLabel('McKinney TX')).toBe('Now curating McKinney, TX');
    expect(marketSealCity('McKinney TX')).toBe('MCKINNEY');
  });

  it('shows 2 adventures only while generate still issues 2', () => {
    const generate = readFileSync(path.join(root, 'src/lib/challenges/generate.ts'), 'utf8');
    expect(generate).toMatch(/const CHALLENGE_ITEMS_PER_MONTH = 2;/);
    expect(CURATED_ADVENTURES_PER_MONTH).toBe(2);
    expect(curatedAdventuresFact(2)).toEqual({
      value: 2,
      label: 'curated adventures a month',
    });
    expect(curatedAdventuresFact(3)).toBeNull();
  });
});
