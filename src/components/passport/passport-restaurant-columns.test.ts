import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const PASSPORT = 'src/components/passport/passport-content.tsx';
const GRANT_MIGRATION = 'supabase/migrations/20260923165733_g13_c_hide_photo_url_columns.sql';

/**
 * Column SELECT granted to anon and authenticated on public.restaurants
 * after G13-C. lat, lon, image_url, and google_photo_url are not in this list.
 */
const AUTHENTICATED_RESTAURANT_SELECT = [
  'address',
  'cuisine_tags',
  'description',
  'google_place_id',
  'id',
  'is_dairy_free',
  'is_halal',
  'is_vegan',
  'name',
  'neighborhood',
  'price_range',
  'slug',
  'status',
] as const;

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function parenthesizedList(sql: string, marker: string): string[] {
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
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

function passportUserRestaurantColumns(src: string): string[] {
  const call = src.indexOf('await createClient()');
  const admin = src.indexOf('getSupabaseAdmin()');
  expect(call).toBeGreaterThanOrEqual(0);
  expect(admin).toBeGreaterThan(call);
  return parenthesizedList(src.slice(call, admin), 'restaurants (');
}

describe('passport restaurant column grants', () => {
  it('matches the G13-C authenticated restaurants SELECT grant', () => {
    const sql = source(GRANT_MIGRATION).replace(/--[^\n]*/g, '');
    const granted = parenthesizedList(sql, 'grant select (');
    expect([...granted].sort()).toEqual([...AUTHENTICATED_RESTAURANT_SELECT].sort());
  });

  it('keeps the user-scoped passport embed inside the granted columns', () => {
    const src = source(PASSPORT);
    const columns = passportUserRestaurantColumns(src);
    const granted = new Set<string>(AUTHENTICATED_RESTAURANT_SELECT);

    expect(columns.length).toBeGreaterThan(0);
    expect(columns.filter((column) => !granted.has(column))).toEqual([]);
    expect(columns).not.toContain('lat');
    expect(columns).not.toContain('lon');
    expect(columns).not.toContain('image_url');

    const admin = src.slice(src.indexOf('getSupabaseAdmin()'));
    expect(admin).toContain(".from('restaurants')");
    expect(admin).toContain(".select('id, image_url, lat, lon')");
    expect(admin).toContain(".in('id', uniqueRestaurantIds)");
  });
});
