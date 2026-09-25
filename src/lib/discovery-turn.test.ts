import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyRouletteAccounting } from '@/lib/ai-budget/accounting';
import { ROULETTE_MAX_MESSAGE_CHARS } from '@/lib/ai-bounds';
import { discoveryReplayMac } from '@/lib/ai-guest';
import {
  buildStoredDiscoveryPayload,
  canonicalFilterString,
  decideReplay,
  discoveryCardSentence,
  DISCOVERY_ALLERGY_ERROR,
  gateDiscoveryMessage,
  gateSignedInProfile,
  hasSavedAllergy,
  isIdInPromptRows,
  mergeExcludedCuisines,
  messageHitsSafetyList,
  parseModelRestaurantId,
} from '@/lib/discovery-turn';

const ROOT = path.resolve(__dirname, '../..');
const SECRET = 'test-guest-signing-secret';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('discovery message gate', () => {
  it('rejects a listed phrase with 422 and does not treat a miss as a hit', () => {
    const shrimp = gateDiscoveryMessage('I cannot have shrimp');
    expect(shrimp.ok).toBe(false);
    if (!shrimp.ok) {
      expect(shrimp.status).toBe(422);
      expect(shrimp.error).toBe(DISCOVERY_ALLERGY_ERROR);
      expect(shrimp.error.toLowerCase()).not.toMatch(/allergy-safe|allergen-free|safe for/);
    }
    expect(messageHitsSafetyList('I avoid cashews')).toBe(false);
    expect(gateDiscoveryMessage('date night').ok).toBe(true);
    expect(gateDiscoveryMessage('quiet dinner').ok).toBe(true);
    expect(gateDiscoveryMessage('not too expensive').ok).toBe(true);
  });

  it('rejects an over-long message whole, including one that starts with a listed phrase', () => {
    const over = `I cannot have shrimp ${'a'.repeat(ROULETTE_MAX_MESSAGE_CHARS)}`;
    expect(over.length).toBeGreaterThan(ROULETTE_MAX_MESSAGE_CHARS);
    const gated = gateDiscoveryMessage(over);
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.status).toBe(400);
    expect(gateDiscoveryMessage('a'.repeat(ROULETTE_MAX_MESSAGE_CHARS)).ok).toBe(true);
    expect(gateDiscoveryMessage('a'.repeat(ROULETTE_MAX_MESSAGE_CHARS + 1)).ok).toBe(false);
  });
});

describe('saved allergies and profile reads', () => {
  it('treats any non-empty allergy flag as a block and a missing profile as unavailable', () => {
    expect(hasSavedAllergy(['peanut'])).toBe(true);
    expect(hasSavedAllergy(['  ', 'shrimp'])).toBe(true);
    expect(hasSavedAllergy([])).toBe(false);
    expect(hasSavedAllergy(null)).toBe(false);
    expect(hasSavedAllergy(['  '])).toBe(false);

    const missing = gateSignedInProfile({
      profileError: false,
      profile: null,
      preferencesError: false,
      excludedCuisines: [],
    });
    expect(missing).toEqual({ ok: false, reason: 'unavailable' });

    const allergy = gateSignedInProfile({
      profileError: false,
      profile: {
        subscription_status: 'active',
        dietary_flags: [],
        allergy_flags: ['peanut'],
      },
      preferencesError: false,
      excludedCuisines: [],
    });
    expect(allergy).toEqual({ ok: false, reason: 'allergy' });

    const prefsDown = gateSignedInProfile({
      profileError: false,
      profile: {
        subscription_status: 'active',
        dietary_flags: ['vegan'],
        allergy_flags: [],
      },
      preferencesError: true,
      excludedCuisines: null,
    });
    expect(prefsDown).toEqual({ ok: false, reason: 'unavailable' });

    const free = gateSignedInProfile({
      profileError: false,
      profile: {
        subscription_status: null,
        dietary_flags: [],
        allergy_flags: [],
      },
      preferencesError: false,
      excludedCuisines: null,
    });
    expect(free.ok).toBe(true);
    if (free.ok) expect(free.accountTier).toBe('free');
  });
});

describe('server card, prompt membership, and accounting', () => {
  it('writes the card from verified fields and ignores model prose', () => {
    const sentence = discoveryCardSentence(
      {
        name: 'Bella',
        neighborhood: 'Downtown',
        cuisine_tags: ['Italian'],
        price_range: '$$',
      },
      'McKinney, Texas',
    );
    expect(sentence).toBe(
      'Bella is a McKinney, Texas partner, in Downtown, tagged Italian, listed at $$. Confirm details with the restaurant.',
    );
    expect(sentence.toLowerCase()).not.toMatch(/safe for|allergy-safe/);
    const prose =
      '{"restaurantId":"abc","reason":"best vibe","vibeMatch":"cozy","suggestedDish":"pasta"}';
    expect(parseModelRestaurantId(prose)).toBe('abc');
  });

  it('marks an id outside the prompt rows invalid and reconciles when usage exists', () => {
    const promptIds = ['in-prompt'];
    expect(isIdInPromptRows('in-prompt', promptIds)).toBe(true);
    expect(isIdInPromptRows('only-in-pool', promptIds)).toBe(false);
    expect(isIdInPromptRows(null, promptIds)).toBe(false);
    expect(
      classifyRouletteAccounting({
        dispatched: true,
        pickValid: false,
        usage: { input_tokens: 1 },
      }),
    ).toBe('assumed_spent_reconcile');
    expect(
      classifyRouletteAccounting({
        dispatched: true,
        pickValid: true,
        usage: { input_tokens: 1 },
      }),
    ).toBe('settle');
  });
});

describe('discovery replay HMAC', () => {
  it('keys the MAC with the guest secret and changes when a saved exclusion changes', () => {
    vi.stubEnv('WANDERBITE_GUEST_SIGNING_SECRET', SECRET);
    const quiet = canonicalFilterString({
      dietary: ['vegan', 'halal'],
      excluded: ['thai'],
      vibe: 'Date Night',
      timeOfDay: null,
      priceRange: null,
      preferredCuisine: null,
    });
    const withSaved = canonicalFilterString({
      dietary: ['halal', 'vegan'],
      excluded: mergeExcludedCuisines(['thai'], ['mexican']),
      vibe: 'Date Night',
    });
    expect(quiet).not.toBe(withSaved);
    expect(quiet).toContain('dietary=halal,vegan');
    expect(quiet).toContain('time=');
    const messageMac = discoveryReplayMac('message', 'date night');
    const filterMac = discoveryReplayMac('filter', quiet);
    expect(messageMac).toBe(
      createHmac('sha256', SECRET).update('discovery-replay.v1.message.date night').digest('hex'),
    );
    expect(filterMac).not.toBe(createHash('sha256').update(quiet).digest('hex'));
    expect(discoveryReplayMac('message', 'quiet dinner')).not.toBe(messageMac);
  });

  it('returns ai only for a matching fingerprint and 409s two harmless messages', () => {
    vi.stubEnv('WANDERBITE_GUEST_SIGNING_SECRET', SECRET);
    const filters = canonicalFilterString({ dietary: [], excluded: [] });
    const messageMac = discoveryReplayMac('message', 'date night');
    const otherMac = discoveryReplayMac('message', 'quiet dinner');
    const filterMac = discoveryReplayMac('filter', filters);
    expect(messageMac && otherMac && filterMac).toBeTruthy();
    const pool = new Set(['r1', 'r2']);
    const stored = buildStoredDiscoveryPayload({
      restaurantId: 'r1',
      selectionMode: 'ai',
      promptIds: ['r1', 'r2'],
      messageMac: messageMac!,
      filterMac: filterMac!,
    });
    expect(stored).not.toHaveProperty('message');
    expect(stored).not.toHaveProperty('reason');
    expect(stored).not.toHaveProperty('vibeMatch');
    expect(stored).not.toHaveProperty('suggestedDish');

    expect(
      decideReplay({ payload: stored, messageMac: messageMac!, filterMac: filterMac!, poolIds: pool }),
    ).toEqual({ outcome: 'ai', restaurantId: 'r1' });

    expect(
      decideReplay({ payload: stored, messageMac: otherMac!, filterMac: filterMac!, poolIds: pool }),
    ).toEqual({ outcome: 'mismatch' });

    const legacy = { restaurantId: 'r1', selectionMode: 'ai', reason: 'old prose' };
    expect(
      decideReplay({ payload: legacy, messageMac: messageMac!, filterMac: filterMac!, poolIds: pool })
        .outcome,
    ).toBe('legacy');

    const outsidePrompt = buildStoredDiscoveryPayload({
      restaurantId: 'r2',
      selectionMode: 'ai',
      promptIds: ['r1'],
      messageMac: messageMac!,
      filterMac: filterMac!,
    });
    expect(
      decideReplay({
        payload: outsidePrompt,
        messageMac: messageMac!,
        filterMac: filterMac!,
        poolIds: pool,
      }).outcome,
    ).toBe('legacy_discard');
  });
});

describe('discovery route contracts', () => {
  it('keeps one fetch, gates before reserve, and leaves ceilings and checkout alone', () => {
    const route = readFileSync(path.join(ROOT, 'src/app/api/roulette/route.ts'), 'utf8');
    const client = readFileSync(path.join(ROOT, 'src/lib/roulette-api-client.ts'), 'utf8');
    const hero = readFileSync(path.join(ROOT, 'src/components/roulette/roulette-hero.tsx'), 'utf8');
    const page = readFileSync(path.join(ROOT, 'src/components/roulette/roulette-client.tsx'), 'utf8');
    const checkout = readFileSync(path.join(ROOT, 'src/lib/checkout-enabled.ts'), 'utf8');
    const migration = readFileSync(
      path.join(ROOT, 'supabase/migrations/20260919172836_ai_budget_reservations.sql'),
      'utf8',
    );

    expect(route).toMatch(/export const maxDuration = 60/);
    expect(route.match(/fetch\('https:\/\/api\.anthropic\.com\/v1\/messages'/g)?.length).toBe(1);
    expect(route).toMatch(/featureClass = 'optional'/);
    expect(route).toMatch(/featureClass: 'optional' \| 'guest' = 'guest'/);
    expect(route).not.toMatch(/protected_core/);
    expect(route).not.toMatch(/hasAllergyConflict/);
    expect(route).not.toMatch(/generateMonthlyChallengeForUser/);
    expect(route).not.toMatch(/vibeMatch|suggestedDish|allergy-safe|trouble reading/);
    expect(route.indexOf('gateDiscoveryMessage(')).toBeLessThan(route.indexOf('await rpcAiReserve'));
    expect(route).toMatch(/subscription_status, dietary_flags, allergy_flags/);
    expect(route).not.toMatch(/CHECKOUT_ENABLED/);

    expect(client).not.toMatch(/The spin took too long/);
    expect(client).not.toMatch(/vibeMatch|suggestedDish/);
    expect(hero).not.toMatch(/RouletteWheel|Spin the Wheel|Wanderbite Roulette/);
    expect(page).toMatch(/Discovery cannot assess allergies/);
    expect(page).toMatch(/tabIndex=\{-1\}/);
    expect(page).not.toMatch(/RouletteWheel|Spin Again|Vibe match|Spin the Wheel/);

    expect(checkout).toMatch(/=== 'true'/);
    expect(migration).toMatch(/1000000/);
    expect(migration).toMatch(/200000/);
  });
});
