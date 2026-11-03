import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chicagoRevealPeriod } from '@/lib/challenges/reveal';
import {
  appendRevealTranscript,
  curationConstraintLines,
  reasonForSlot,
  reasonsFromRevealJson,
  REVEAL_TRY_AGAIN,
  revealMemberMessage,
  SWAPPED_SLOT_REASON,
} from '@/lib/challenges/monthly-reveal-copy';
import {
  logRevealUnavailableOnce,
  monthlyRevealEnabled,
  resetMonthlyRevealUnavailableLog,
  revealSchemaMissing,
} from '@/lib/challenges/monthly-reveal-flag';

describe('monthly reveal flag', () => {
  beforeEach(() => {
    resetMonthlyRevealUnavailableLog();
    vi.restoreAllMocks();
  });

  it('stays off unless the env value is exactly true', () => {
    expect(monthlyRevealEnabled(undefined)).toBe(false);
    expect(monthlyRevealEnabled('')).toBe(false);
    expect(monthlyRevealEnabled('TRUE')).toBe(false);
    expect(monthlyRevealEnabled('1')).toBe(false);
    expect(monthlyRevealEnabled('true')).toBe(true);
  });

  it('recognizes only the schema-missing codes', () => {
    expect(revealSchemaMissing(null)).toBe(false);
    for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
      expect(revealSchemaMissing({ code, message: 'schema cache' })).toBe(true);
    }
    expect(revealSchemaMissing({ code: '42P01', message: 'relation "challenge_reveals" does not exist' })).toBe(true);
    expect(revealSchemaMissing({ code: '42883', message: 'function reveal_monthly_challenge does not exist' })).toBe(true);
    expect(revealSchemaMissing({ code: '', message: 'Could not find the function public.reveal_monthly_challenge' })).toBe(true);
    expect(revealSchemaMissing({ code: '', message: 'Could not find the table public.challenge_reveals' })).toBe(true);
    expect(revealSchemaMissing({ code: '500', message: 'upstream connect error' })).toBe(false);
    expect(revealSchemaMissing({ code: 'XX000', message: 'network timeout' })).toBe(false);
    expect(revealSchemaMissing({ code: '42501', message: 'permission denied' })).toBe(false);
  });

  it('logs the fallback once and without a user id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logRevealUnavailableOnce();
    logRevealUnavailableOnce();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain('monthly reveal unavailable');
    expect(line).not.toMatch(/user/i);
  });
});

describe('monthly reveal copy', () => {
  it('keeps a 23:30 Chicago reveal in November', () => {
    expect(chicagoRevealPeriod(new Date('2026-12-01T05:30:00.000Z'))).toBe('2026-11-01');
  });

  it('shows the saved reason only for the restaurant that is still in the slot', () => {
    const reasons = [
      { restaurantId: 'alpha', text: 'Alpha: $20 base savings at $50 minimum spend.' },
      { restaurantId: 'beta', text: 'Beta: $15 base savings at $40 minimum spend.' },
    ];
    expect(reasonForSlot(reasons, 'alpha')).toContain('Alpha');
    expect(reasonForSlot(reasons, 'swapped')).toBe(SWAPPED_SLOT_REASON);
    expect(reasonForSlot([], 'alpha')).toBeNull();
    expect(reasonForSlot(null, 'alpha')).toBeNull();
  });

  it('parses saved item reasons and drops a bad payload', () => {
    expect(
      reasonsFromRevealJson([
        { restaurant_id: 'alpha', template_id: 'deterministic_pair_v1', text: 'Alpha' },
      ]),
    ).toEqual([{ restaurantId: 'alpha', text: 'Alpha' }]);
    expect(reasonsFromRevealJson([{ restaurant_id: 'alpha' }])).toBeNull();
  });

  it('maps thin pool to the server sentence and capacity-style failures to try again', () => {
    const thin = 'No eligible restaurants found within your travel distance. Try a wider distance or check dietary preferences.';
    expect(revealMemberMessage({ error: thin, reason: 'thin_pool' })).toBe(thin);
    for (const reason of ['capacity_full', 'invalid_restaurants', 'incomplete_cycle', 'retryable']) {
      expect(revealMemberMessage({ error: 'A restaurant in this pair is at capacity.', reason })).toBe(REVEAL_TRY_AGAIN);
    }
    expect(
      revealMemberMessage({
        error: 'An active Wanderbite subscription is required to generate challenges.',
        reason: 'inactive_subscription',
      }),
    ).toContain('subscription');
  });

  it('summarizes saved distance, diet, and exclusions without calling them driving time', () => {
    const lines = curationConstraintLines({
      distanceBand: '15_mi',
      dietaryFlags: ['vegetarian'],
      allergyFlags: [],
      excludedCuisines: ['thai'],
    });
    const text = lines.join(' ');
    expect(text).toContain('15 miles');
    expect(text).toContain('Vegetarian');
    expect(text).toContain('Thai');
    expect(text).toContain('not a driving-time estimate');
    expect(text).toContain('does not choose the restaurants');
  });

  it('caps a spoken note at the reveal summary length', () => {
    const spoken = appendRevealTranscript('assign Hutchins BBQ', ' please');
    expect(spoken).toBe('assign Hutchins BBQ please');
    expect(appendRevealTranscript('x'.repeat(280), 'more').length).toBe(280);
  });
});
