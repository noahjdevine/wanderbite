import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const MIGRATION = 'supabase/migrations/20260908155255_restaurants_cron_runs_grants.sql';

const ALLOWLIST = [
  'id',
  'name',
  'slug',
  'status',
  'cuisine_tags',
  'neighborhood',
  'address',
  'description',
  'price_range',
  'image_url',
  'google_photo_url',
  'google_place_id',
  'is_dairy_free',
  'is_vegan',
  'is_halal',
] as const;

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function parenthesizedList(sql: string, marker: string): string[] {
  const start = sql.indexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf('(', start);
  const close = sql.indexOf(')', open);
  expect(open).toBeGreaterThan(start);
  expect(close).toBeGreaterThan(open);
  return sql
    .slice(open + 1, close)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

describe('G8 SEC-06 sensitive table access (source)', () => {
  it('uses a forward-only M5 with hybrid restaurants grants and an invoker view', () => {
    const raw = source(MIGRATION);
    const sql = raw.replace(/--[^\n]*/g, '');
    expect(sql).not.toMatch(/^\s*(begin|start\s+transaction|commit|rollback)\b/im);
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '30s'");
    expect(sql).not.toMatch(/alter default privileges/i);
    expect(sql).toMatch(/alter table public\.restaurants enable row level security/i);
    expect(sql).toMatch(/alter table public\.markets enable row level security/i);
    expect(sql).toMatch(/alter table public\.restaurant_orgs enable row level security/i);
    expect(sql).toMatch(/alter table public\.restaurant_offers enable row level security/i);
    expect(sql).toMatch(/create policy "Public can read active restaurants"/i);
    expect(sql).toMatch(/using \(status = 'active'\)/);
    expect(sql).toMatch(/create or replace view public\.restaurants_public\s+with \(security_invoker = true\)/i);
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toMatch(/revoke all on table public\.restaurants\s+from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant select, insert, update, delete on table public\.restaurants to service_role/i);
    expect(sql).toMatch(/revoke all on table public\.cron_runs\s+from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/revoke all on sequence public\.cron_runs_id_seq\s+from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant select, insert, update on table public\.cron_runs to service_role/i);
    expect(sql).toMatch(/grant usage, select, update on sequence public\.cron_runs_id_seq to service_role/i);
    expect(sql).toMatch(/grant select, insert on table public\.markets to service_role/i);
    expect(sql).toMatch(/grant select, insert, delete on table public\.restaurant_orgs to service_role/i);
    expect(sql).toMatch(/grant select, insert, delete on table public\.restaurant_offers to service_role/i);
    expect(sql).not.toMatch(/create policy.*on public\.cron_runs/i);
    expect(sql).not.toMatch(/create policy.*on public\.markets/i);
    expect(sql).not.toMatch(/create policy.*on public\.restaurant_orgs/i);
    expect(sql).not.toMatch(/create policy.*on public\.restaurant_offers/i);

    const normalized = sql.replace(/\r\n/g, '\n');
    const grantCols = parenthesizedList(normalized, 'grant select (');
    const viewStart = normalized.indexOf('view public.restaurants_public');
    const viewSelectStart = normalized.indexOf(' as\nselect', viewStart);
    expect(viewStart).toBeGreaterThanOrEqual(0);
    expect(viewSelectStart).toBeGreaterThan(viewStart);
    const viewSelect = normalized.slice(viewSelectStart + ' as\nselect'.length);
    const viewCols = viewSelect
      .slice(0, viewSelect.indexOf('from public.restaurants'))
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    expect(grantCols).toEqual([...ALLOWLIST]);
    expect(viewCols).toEqual([...ALLOWLIST]);
    expect(grantCols).not.toContain('pin_hash');
    expect(grantCols).not.toContain('verification_code');
    expect(viewCols).not.toContain('pin_hash');
    expect(viewCols).not.toContain('verification_code');
  });

  it('keeps pin_hash on the server side of admin and out of admin-client props', () => {
    const page = source('src/app/(site)/admin/page.tsx');
    const client = source('src/app/(site)/admin/admin-client.tsx');
    expect(page).toMatch(/getSupabaseAdmin\(\)/);
    expect(page).toMatch(/pin_hash/);
    expect(page).toMatch(/has_pin:\s*Boolean\(row\.pin_hash\)/);
    expect(page).not.toMatch(/pin_hash:\s*row\.pin_hash/);
    expect(client).toMatch(/has_pin:\s*boolean/);
    expect(client).toMatch(/r\.has_pin/);
    expect(client).not.toMatch(/pin_hash/);
  });

  it('requires the service-role key for seed and does not fall back to the anon key', () => {
    const seed = source('scripts/seed.ts');
    expect(seed).toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    expect(seed).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(seed).toMatch(/Missing SUPABASE_SERVICE_ROLE_KEY/);
  });
});
