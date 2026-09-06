import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA_CONTRACT } from '@/lib/schema-contract';

const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');
const TYPES_FILE = path.join(ROOT, 'src/types/database.types.ts');

const RECONCILE_MIGRATIONS = [
  '20260902195734_user_profiles_billing_admin_address.sql',
  '20260902195736_badges_and_user_badges.sql',
  '20260902195738_cron_runs_enable_rls.sql',
  '20260902225901_markets_slug_required.sql',
  '20260902225902_badge_icon_glyphs.sql',
] as const;

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function extractTableRowKeys(src: string, table: string): string[] {
  const tableStart = src.indexOf(`      ${table}: {`);
  if (tableStart < 0) return [];
  const rowStart = src.indexOf('Row: {', tableStart);
  const insertStart = src.indexOf('Insert: {', rowStart);
  if (rowStart < 0 || insertStart < 0 || insertStart <= rowStart) return [];
  const body = src.slice(rowStart, insertStart);
  return [...body.matchAll(/^\s{10}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]);
}

describe('OPS-03 schema contract', () => {
  it('keeps generated types aligned with the app table contract', () => {
    const src = readFileSync(TYPES_FILE, 'utf8');
    for (const [table, columns] of Object.entries(SCHEMA_CONTRACT)) {
      expect(sorted(extractTableRowKeys(src, table)), table).toEqual(sorted(columns));
    }
  });

  // Actual migration replay, constraints, types and RLS are tested by test:db.
  // Finding a column name anywhere in SQL (even a comment) cannot prove schema parity.

  it('includes the OPS-03 reconciliation migrations', () => {
    const files = readdirSync(MIGRATIONS_DIR);
    for (const name of RECONCILE_MIGRATIONS) {
      expect(files).toContain(name);
    }
  });

  it('does not rewrite historical profile update grants for SEC-01', () => {
    const initial = readFileSync(path.join(MIGRATIONS_DIR, '001_initial_schema.sql'), 'utf8');
    const g2 = readFileSync(
      path.join(MIGRATIONS_DIR, '20260906012137_user_profiles_privilege_grants.sql'),
      'utf8',
    );
    expect(initial).toMatch(/create policy "Users can update own profile"/);
    expect(g2).toMatch(/revoke insert,\s*update on table public\.user_profiles from anon, authenticated/i);
    expect(g2).not.toMatch(/grant (insert|update) on table public\.user_profiles/i);
  });

  it('does not rewrite historical migrations for hashed partner sessions', () => {
    const initial = readFileSync(path.join(MIGRATIONS_DIR, '001_initial_schema.sql'), 'utf8');
    const g3 = readFileSync(
      path.join(MIGRATIONS_DIR, '20260906195909_partner_sessions.sql'),
      'utf8',
    );
    expect(initial).not.toMatch(/partner_sessions/);
    expect(g3).toMatch(/create table public\.partner_sessions/);
    expect(g3).toMatch(/revoke all on table public\.partner_sessions/i);
    expect(g3).toMatch(/grant select, insert, delete on table public\.partner_sessions/i);
  });

  it('does not rewrite historical migrations for billing or address columns', () => {
    const initial = readFileSync(path.join(MIGRATIONS_DIR, '001_initial_schema.sql'), 'utf8');
    expect(initial).not.toMatch(/subscription_status/);
    expect(initial).not.toMatch(/is_admin/);
    expect(initial).not.toMatch(/address_street/);

    const reconcile = readFileSync(
      path.join(MIGRATIONS_DIR, RECONCILE_MIGRATIONS[0]),
      'utf8',
    );
    expect(reconcile).toMatch(/add column if not exists subscription_status/);
    expect(reconcile).toMatch(/add column if not exists is_admin/);
    expect(reconcile).toMatch(/add column if not exists address_street/);
  });
});
