import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStoredChallengeSavings } from '@/lib/boost/challenge-settlement';
import type { StoredRedemptionSettlement } from '@/lib/boost/settlement-store';

const ROOT = path.resolve(__dirname, '../../..');
const REDEMPTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Row = StoredRedemptionSettlement & { id: string };

function quoteRow(total: number): Row {
  return {
    id: REDEMPTION,
    settlement_kind: 'consume_quote',
    settled_at: '2026-11-08T18:05:00.000Z',
    quote_id: '22222222-2222-4222-8222-222222222222',
    quote_version: 1,
    base_discount_cents: 1000,
    boost_discount_cents: total - 1000,
    total_discount_cents: total,
    eligible_subtotal_cents: 6000,
    below_minimum: false,
    tier_id: 'threshold:4000',
    boost_id: 'boost-1',
    locked_boost_id: 'boost-1',
    quote_expires_at: '2026-11-08T22:00:00.000Z',
    sealed_discount_amount_cents: null,
    sealed_min_spend_cents: null,
  };
}

function reader(result: { data: Row[] | null; error: { message: string } | null }) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      return {
        select(columns: string) {
          calls.push(columns);
          return {
            in() {
              return Promise.resolve(result);
            },
          };
        },
      };
    },
  };
}

describe('challenge settlement read', () => {
  beforeEach(() => {
    delete process.env.E07_ARRIVAL_SESSIONS_ENABLED;
  });

  it('does not query unless the arrival flag is exactly true', async () => {
    const off = reader({ data: [quoteRow(1500)], error: null });
    await expect(loadStoredChallengeSavings(off, [REDEMPTION])).resolves.toEqual(new Map());
    expect(off.calls).toEqual([]);

    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'TRUE';
    const wrong = reader({ data: [quoteRow(1500)], error: null });
    await expect(loadStoredChallengeSavings(wrong, [REDEMPTION])).resolves.toEqual(new Map());
    expect(wrong.calls).toEqual([]);

    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    const empty = reader({ data: [quoteRow(1500)], error: null });
    await expect(loadStoredChallengeSavings(empty, [])).resolves.toEqual(new Map());
    expect(empty.calls).toEqual([]);
  });

  it('returns persisted cents and omits a missing or unreadable snapshot', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    const found = reader({ data: [quoteRow(1500)], error: null });
    const saved = await loadStoredChallengeSavings(found, [REDEMPTION]);
    expect(saved.get(REDEMPTION)).toBe(1500);
    expect(found.calls[0]).toBe('redemptions');
    expect(found.calls[1]).toContain('settlement_kind');
    expect(found.calls[1]).toContain('total_discount_cents');

    const miss = reader({
      data: [
        {
          ...quoteRow(1500),
          settlement_kind: 'use_sealed_base',
          quote_id: null,
          total_discount_cents: null,
          base_discount_cents: null,
          boost_discount_cents: null,
          eligible_subtotal_cents: null,
          below_minimum: null,
          quote_expires_at: null,
          sealed_discount_amount_cents: null,
          sealed_min_spend_cents: null,
        },
      ],
      error: null,
    });
    await expect(loadStoredChallengeSavings(miss, [REDEMPTION])).resolves.toEqual(new Map());

    const broken = reader({ data: [{ ...quoteRow(1500), quote_id: null }], error: null });
    await expect(loadStoredChallengeSavings(broken, [REDEMPTION])).resolves.toEqual(new Map());

    const failed = reader({ data: null, error: { message: 'column settlement_kind does not exist' } });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(loadStoredChallengeSavings(failed, [REDEMPTION])).resolves.toEqual(new Map());
    error.mockRestore();
  });

  it('does not recompute a quote or write a settlement', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/boost/challenge-settlement.ts'), 'utf8');
    const loader = readFileSync(path.join(ROOT, 'src/lib/challenges/generate.ts'), 'utf8');
    expect(source).not.toMatch(/quoteBoost|insert\(|update\(/);
    expect(source).toMatch(/arrivalSessionsEnabled\(\)/);
    expect(loader).toMatch(/loadStoredChallengeSavings/);
    expect(loader).not.toMatch(/SETTLEMENT_COLUMNS|quoteBoost/);
  });
});
