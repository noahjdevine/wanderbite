import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { MINIMUM_CREDIT_BASE_CENTS, meetsMinimumCreditBase } from '@/lib/offers/credit-floor';

describe('credit floor parity', () => {
  it('exports the 1000-cent minimum and helper', () => {
    expect(MINIMUM_CREDIT_BASE_CENTS).toBe(1000);
    expect(meetsMinimumCreditBase(1000)).toBe(true);
    expect(meetsMinimumCreditBase(999)).toBe(false);
    expect(meetsMinimumCreditBase(null)).toBe(false);
  });

  it('matches the forward migration SQL literal for credit_floor_cents()', () => {
    const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
    const migration = readdirSync(migrationsDir)
      .filter((name) => name.includes('e02_independent_credit_floor'))
      .sort()
      .at(-1);
    expect(migration, 'e02_independent_credit_floor migration').toBeTruthy();
    const sql = readFileSync(path.join(migrationsDir, migration!), 'utf8');
    expect(sql).toMatch(/create or replace function public\.credit_floor_cents\(\)/i);
    expect(sql).toMatch(/select\s+1000\s*;/i);
    expect(MINIMUM_CREDIT_BASE_CENTS).toBe(1000);
  });
});
