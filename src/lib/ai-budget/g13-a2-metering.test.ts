import { describe, expect, it } from 'vitest';
import { classifyRouletteAccounting } from '@/lib/ai-budget/accounting';
import { conservativeInputUnits, rouletteQuoteUsageUnits } from '@/lib/ai-budget/quote';
import { usageUnitsFromAnthropic } from '@/lib/ai-budget/usage';

describe('G13-A2 conservative quote', () => {
  it('is strictly above a chars/4 estimate and includes max_tokens 300', () => {
    const system = 'a'.repeat(400);
    const user = 'b'.repeat(400);
    const naive = Math.ceil((system.length + user.length) / 4);
    const conservative = conservativeInputUnits(system, user);
    expect(conservative).toBeGreaterThan(naive);
    expect(conservative).toBeGreaterThan(4096);
    expect(rouletteQuoteUsageUnits(system, user).output).toBe(300);
  });
});

describe('G13-A2 Anthropic usage parse', () => {
  it('uses TTL breakdown without adding aggregate cache_creation', () => {
    const units = usageUnitsFromAnthropic({
      input_tokens: 10,
      output_tokens: 4,
      cache_creation_input_tokens: 99,
      cache_creation: {
        ephemeral_5m_input_tokens: 7,
        ephemeral_1h_input_tokens: 3,
      },
      cache_read_input_tokens: 2,
    });
    expect(units).toEqual({
      input: 10,
      output: 4,
      cache_read: 2,
      cache_write_5m: 7,
      cache_write_1h: 3,
    });
    expect(units && (units.cache_write_5m ?? 0) + (units.cache_write_1h ?? 0)).toBe(10);
    expect(units).not.toMatchObject({ cache_write_5m: 99 });
  });

  it('returns null when usage is missing', () => {
    expect(usageUnitsFromAnthropic(undefined)).toBeNull();
    expect(usageUnitsFromAnthropic({})).toBeNull();
  });
});

describe('G13-A2 accounting paths', () => {
  it('settles only a valid pick with known usage', () => {
    expect(
      classifyRouletteAccounting({ dispatched: true, pickValid: true, usage: { input: 1 } }),
    ).toBe('settle');
  });

  it('does not settle unusable JSON when usage is known', () => {
    expect(
      classifyRouletteAccounting({ dispatched: true, pickValid: false, usage: { input: 1 } }),
    ).toBe('assumed_spent_reconcile');
  });

  it('releases the customer when usage is unknown after dispatch', () => {
    expect(
      classifyRouletteAccounting({ dispatched: true, pickValid: true, usage: null }),
    ).toBe('assumed_spent_release');
  });

  it('fails before dispatch when the provider was never called', () => {
    expect(
      classifyRouletteAccounting({ dispatched: false, pickValid: false, usage: null }),
    ).toBe('fail_before_dispatch');
  });
});
