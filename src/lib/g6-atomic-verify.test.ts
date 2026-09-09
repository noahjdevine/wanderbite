import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REDEMPTION_TTL_DAYS } from '@/lib/redemption-expiry';

const ROOT = path.resolve(__dirname, '../..');
const MIGRATION = 'supabase/migrations/20260907174245_redemptions_verify_rpc.sql';

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('G6 atomic redemption verify (source)', () => {
  it('uses a forward-only verify RPC with expires_at and no null loophole', () => {
    const raw = source(MIGRATION);
    const sql = raw.replace(/--[^\n]*/g, '').replace(/\$\$[\s\S]*?\$\$/g, ' FUNCTION_BODY ');
    expect(source('supabase/migrations/001_initial_schema.sql')).not.toMatch(/verify_redemption/);
    expect(sql).not.toMatch(/^\s*(begin|start\s+transaction|commit|rollback)\b/im);
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '30s'");
    expect(raw).toMatch(/redemptions\.created_at contains nulls; refuse backfill/);
    expect(sql).toMatch(/add column expires_at timestamptz/);
    expect(sql).toMatch(/alter column expires_at set not null/);
    expect(sql).toMatch(/interval '35 days'/);
    expect(raw).toMatch(/and expires_at > now\(\)/);
    expect(raw).not.toMatch(/expires_at is null/i);
    expect(sql).toMatch(/security invoker/);
    expect(sql).not.toMatch(/security definer/);
    expect(raw).toMatch(/duplicate issued redemptions for token_hash/);
    expect(sql).toMatch(/revoke all on function public\.verify_redemption\(text, uuid\)/i);
    expect(sql).toMatch(/grant execute on function public\.verify_redemption\(text, uuid\)\s+to service_role/i);
    expect(REDEMPTION_TTL_DAYS).toBe(35);
  });

  it('verifies through the RPC and never updates redemptions by id', () => {
    const verify = source('src/app/actions/partner-verify.ts');
    expect(verify).toMatch(/rpc\('verify_redemption'/);
    expect(verify).not.toMatch(/\.update\(\{\s*status:\s*'verified'/);
    expect(verify).toMatch(/claimed\.length > 1/);
    expect(verify).toMatch(/enforcePartnerVerifyLimit/);
    expect(source('src/app/actions/redeem-challenge.ts')).toMatch(/p_expires_at:\s*redemptionExpiresAt/);
    expect(source('src/lib/ratelimit.ts')).toMatch(/slidingWindow\(20, '5 m'\)/);
    expect(source('src/lib/ratelimit.ts')).toMatch(/slidingWindow\(60, '5 m'\)/);
  });
});
