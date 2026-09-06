import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const MIGRATION = 'supabase/migrations/20260906195909_partner_sessions.sql';

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walkTsFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('G3 hashed partner sessions (source)', () => {
  it('uses a forward-only service-role-only partner_sessions migration', () => {
    const sql = source(MIGRATION).replace(/--[^\n]*/g, '');
    expect(source('supabase/migrations/001_initial_schema.sql')).not.toMatch(/partner_sessions/);
    expect(sql).not.toMatch(/^\s*(begin|start\s+transaction|commit|rollback)\b/im);
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '30s'");
    expect(sql).toMatch(/token_hash text primary key/);
    expect(sql).toMatch(/check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(sql).toMatch(/references public\.restaurants \(id\) on delete cascade/);
    expect(sql).toMatch(/check \(expires_at > created_at\)/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on table public\.partner_sessions\s+from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant select, insert, delete on table public\.partner_sessions\s+to service_role/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant update/i);
  });

  it('keeps the session verifier out of use-server modules', () => {
    const helper = source('src/lib/require-partner-session.ts');
    const auth = source('src/app/actions/partner-auth.ts');
    const verify = source('src/app/actions/partner-verify.ts');
    expect(helper.startsWith("import 'server-only';")).toBe(true);
    expect(helper).toMatch(/export async function requirePartnerSession/);
    expect(auth).toMatch(/^'use server';/m);
    expect(auth).not.toMatch(/export async function requirePartnerSession/);
    expect(auth).toMatch(/export async function getPartnerAnalytics\(\)/);
    expect(auth).toMatch(/export async function getPartnerRedemptionsThisMonth\(\)/);
    expect(auth).not.toMatch(/getPartnerAnalytics\(restaurantId/);
    expect(verify).toMatch(/requirePartnerSession\(\)/);
  });

  it('never trusts the legacy UUID cookie for auth', () => {
    const hits: string[] = [];
    for (const file of walkTsFiles(path.join(ROOT, 'src'))) {
      const rel = path.relative(ROOT, file).replaceAll('\\', '/');
      const src = source(rel);
      if (src.includes("get('partner_restaurant_id')") || src.includes('get(LEGACY_PARTNER_COOKIE_NAME)')) {
        hits.push(`${rel}: reads legacy cookie`);
      }
      if (/\bPARTNER_COOKIE_NAME\b/.test(src)) {
        hits.push(`${rel}: old PARTNER_COOKIE_NAME`);
      }
    }
    expect(hits).toEqual([]);
    expect(source('src/lib/partner-session.ts')).toMatch(
      /LEGACY_PARTNER_COOKIE_NAME = 'partner_restaurant_id'/,
    );
    expect(source('src/lib/require-partner-session.ts')).toMatch(/PARTNER_SESSION_COOKIE_NAME/);
    expect(source('src/lib/require-partner-session.ts')).not.toMatch(/cookieStore\.set/);
    expect(source('src/app/partner/[slug]/page.tsx')).toMatch(/getPartnerAnalytics\(\)/);
    expect(source('src/app/partner/[slug]/page.tsx')).not.toMatch(
      /analytics\.ok \? analytics : null/,
    );
  });
});
