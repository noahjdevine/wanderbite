import { describe, expect, it, vi } from 'vitest';
import { ROULETTE_MAX_RESULT_REASON_CHARS } from '@/lib/ai-bounds';
import { buildDiscoverLinePrompt, validateDiscoverLine } from '@/lib/discover/pick-line';

const OTHERS = ['Salsa Room', 'Smokehouse', 'Fancy Tacos'];

function decide(text: string, otherRestaurantNames: readonly string[] = OTHERS) {
  return validateDiscoverLine({ text, otherRestaurantNames });
}

describe('validateDiscoverLine', () => {
  it('trims, strips wrapping quotes, and keeps one sentence', () => {
    expect(decide('  "Taco House is a bright room for tacos."  ')).toEqual({
      ok: true,
      line: 'Taco House is a bright room for tacos.',
    });
    expect(decide('“Taco House is a bright room for tacos.”')).toEqual({
      ok: true,
      line: 'Taco House is a bright room for tacos.',
    });
    expect(decide('Taco House is a bright room for tacos')).toMatchObject({ ok: true });
  });

  it('clips one long sentence and does not log it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const text = `${'A'.repeat(ROULETTE_MAX_RESULT_REASON_CHARS + 40)}.`;
    const decision = decide(text);
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.line).toHaveLength(ROULETTE_MAX_RESULT_REASON_CHARS);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects an empty line', () => {
    expect(decide('   ')).toEqual({ ok: false, code: 'empty' });
    expect(decide('""')).toEqual({ ok: false, code: 'empty' });
    expect(decide('...')).toEqual({ ok: false, code: 'empty' });
  });

  it('rejects a URL, a phone, a price, hours, a promo, and another name', () => {
    expect(decide('See https://evil.example/secret before you go.')).toEqual({
      ok: false,
      code: 'url',
    });
    expect(decide('Their site is www.example.com today.')).toEqual({ ok: false, code: 'url' });
    expect(decide('Call 555-123-4567 for a table.')).toEqual({ ok: false, code: 'phone' });
    expect(decide('It is only $15.')).toEqual({ ok: false, code: 'price' });
    expect(decide('A cheap taco spot.')).toEqual({ ok: false, code: 'price' });
    expect(decide('Listed at $$.')).toEqual({ ok: false, code: 'price' });
    expect(decide('Open until 9pm.')).toEqual({ ok: false, code: 'hours' });
    expect(decide('Closed Mondays.')).toEqual({ ok: false, code: 'hours' });
    expect(decide('Ask about the discount.')).toEqual({ ok: false, code: 'promo' });
    expect(decide('Twenty percent off the bill.')).toEqual({ ok: false, code: 'promo' });
    expect(decide('Skip Smokehouse and try this room.')).toEqual({
      ok: false,
      code: 'other_restaurant',
    });
    expect(decide('Skip salsa room for a brighter night.')).toEqual({
      ok: false,
      code: 'other_restaurant',
    });
  });

  it('rejects another restaurant name without rejecting the chosen name', () => {
    expect(decide('Salsa Room is the brighter room.')).toEqual({
      ok: false,
      code: 'other_restaurant',
    });
    expect(decide('Taco House is the brighter room.', ['Salsa Room'])).toMatchObject({
      ok: true,
    });
    expect(decide('The greenhouse is lovely.', ['Green'])).toMatchObject({ ok: true });
    expect(decide('A place called Pi.', ['Pi'])).toMatchObject({ ok: true });
  });

  it('rejects an over-long multi-sentence line and raw JSON', () => {
    const ramble = `${'This room is bright. This room is loud. '.repeat(40)}`;
    expect(ramble.length).toBeGreaterThan(ROULETTE_MAX_RESULT_REASON_CHARS);
    expect(decide(ramble)).toEqual({ ok: false, code: 'multi_sentence' });
    expect(decide('Taco House is bright.\nIt is also loud.')).toEqual({
      ok: false,
      code: 'multi_sentence',
    });
    expect(decide('{"restaurantId":"rest-salsa"}')).toEqual({ ok: false, code: 'not_plain' });
  });

  it('keeps a year and does not treat it as a phone number', () => {
    expect(decide('Cooking here since 1998 and still going.')).toMatchObject({ ok: true });
  });
});

describe('buildDiscoverLinePrompt', () => {
  const restaurant = {
    name: 'Taco House',
    cuisine_tags: ['mexican', 'tacos'],
    neighborhood: 'West',
    price_range: '$',
  };

  it('sends one restaurant and the preference lines', () => {
    const prompt = buildDiscoverLinePrompt({
      marketDisplayName: 'McKinney, Texas',
      restaurant,
      preferenceLines: 'Price preference (soft): $\nPreferred cuisine (soft): Mexican',
    });
    expect(prompt.systemPrompt).toContain('one sentence');
    expect(prompt.systemPrompt).toContain('already chosen');
    expect(prompt.userPrompt).toContain('Taco House');
    expect(prompt.userPrompt).toContain('mexican');
    expect(prompt.userPrompt).toContain('West');
    expect(prompt.userPrompt).toContain('"$"');
    expect(prompt.userPrompt).toContain('Preferred cuisine');
    expect(prompt.userPrompt).not.toContain('Salsa Room');
    expect(prompt.userPrompt).not.toContain('"id"');
    expect(prompt.userPrompt).not.toContain('facts');
  });

  it('includes facts only when they are passed', () => {
    const withFacts = buildDiscoverLinePrompt({
      marketDisplayName: 'McKinney, Texas',
      restaurant,
      preferenceLines: '',
      facts: { known_for: 'Known for hand-pressed tortillas.' },
    });
    expect(withFacts.userPrompt).toContain('Known for hand-pressed tortillas.');
    expect(withFacts.userPrompt).toContain('"facts"');
    expect(withFacts.userPrompt).not.toContain('https://');

    const without = buildDiscoverLinePrompt({
      marketDisplayName: 'McKinney, Texas',
      restaurant,
      preferenceLines: '',
      facts: {},
    });
    expect(without.userPrompt).not.toContain('facts');
    expect(without.userPrompt).toContain('(No specific preferences.)');
  });
});
