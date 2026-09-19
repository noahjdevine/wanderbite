import { readFileSync } from 'node:fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  AI_ACCOUNT_TIERS,
  AI_BUDGET_RPCS,
  AI_FEATURE_CLASSES,
  AI_MICRODOLLARS_PER_DOLLAR,
  AI_REQUEST_STATUSES,
  dollarsToMicrodollars,
} from '@/lib/ai-budget';

const ROOT = path.resolve(__dirname, '../../..');

describe('G13-A1 AI budget TypeScript surface', () => {
  it('does not duplicate provider rates outside the database registry', () => {
    const ts = readFileSync(path.join(ROOT, 'src/lib/ai-budget/index.ts'), 'utf8');
    expect(ts).not.toMatch(/claude-haiku/);
    expect(ts).not.toMatch(/microdollars_per_million/);
    expect(ts).not.toMatch(/1_250_000|1250000/);
    expect(AI_MICRODOLLARS_PER_DOLLAR).toBe(1_000_000);
    expect(dollarsToMicrodollars(1)).toBe(1_000_000);
    expect(dollarsToMicrodollars(1) / 5).toBe(200_000);
  });

  it('keeps approved ceilings and the RPC name list', () => {
    expect(dollarsToMicrodollars(1)).toBe(1_000_000);
    expect(AI_FEATURE_CLASSES).toContain('protected_core');
    expect(AI_ACCOUNT_TIERS).toContain('paid');
    expect(AI_REQUEST_STATUSES).toContain('assumed_spent');
    expect(Object.values(AI_BUDGET_RPCS)).toEqual(
      expect.arrayContaining([
        'ai_reserve',
        'ai_dispatch',
        'ai_quote_max_cost',
        'ai_transfer_guest_to_account',
      ]),
    );
  });

  it('documents registry-only rates in the G13-A1 migration', () => {
    const sql = readFileSync(
      path.join(ROOT, 'supabase/migrations/20260919172836_ai_budget_reservations.sql'),
      'utf8',
    );
    expect(sql).toMatch(/claude-haiku-4-5-20251001/);
    expect(sql).toMatch(/revoke all on table public\.ai_requests/i);
    expect(sql).toMatch(/from public, anon, authenticated, service_role/);
    expect(sql).toMatch(/grant execute on function public\.ai_reserve/i);
    expect(sql).not.toMatch(/grant (select|insert|update|delete) on table public\.ai_/i);
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path to pg_catalog, public/);
  });
});
