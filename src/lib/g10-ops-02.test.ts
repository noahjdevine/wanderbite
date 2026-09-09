import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCompleteCurrentLayout } from '@/lib/challenges/current-layout';

const ROOT = path.resolve(__dirname, '../..');
const MIGRATION = 'supabase/migrations/20260909001409_challenge_workflow_transactions.sql';

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('current challenge layout', () => {
  it('requires one current item per slot with distinct restaurants', () => {
    expect(
      isCompleteCurrentLayout([
        { slot_number: 1, status: 'assigned', restaurant_id: 'a' },
        { slot_number: 2, status: 'redeemed', restaurant_id: 'b' },
        { slot_number: 1, status: 'swapped_out', restaurant_id: 'c' },
      ])
    ).toBe(true);
    expect(
      isCompleteCurrentLayout([
        { slot_number: 1, status: 'assigned', restaurant_id: 'a' },
        { slot_number: 2, status: 'assigned', restaurant_id: 'a' },
      ])
    ).toBe(false);
    expect(
      isCompleteCurrentLayout([
        { slot_number: 1, status: 'assigned', restaurant_id: 'a' },
        { slot_number: 1, status: 'swapped_out', restaurant_id: 'b' },
      ])
    ).toBe(false);
  });
});

describe('G10 OPS-02 challenge transactions (source)', () => {
  it('uses a forward-only M7 with current-item uniques and invoker RPCs', () => {
    const raw = source(MIGRATION);
    const sql = raw.replace(/--[^\n]*/g, '').replace(/\$\$[\s\S]*?\$\$/g, ' FUNCTION_BODY ');
    expect(source('supabase/migrations/001_initial_schema.sql')).not.toMatch(/generate_challenge_cycle/);
    expect(sql).not.toMatch(/^\s*(begin|start\s+transaction|commit|rollback)\b/im);
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '30s'");
    const bodies = raw.split('create or replace function').slice(1).join('\n');
    expect(bodies).not.toMatch(/lock_timeout/);
    expect(bodies).not.toMatch(/statement_timeout/);
    expect(sql).toMatch(/status in \('assigned', 'redeemed'\)/);
    expect(raw).toMatch(/on conflict \(user_id, cycle_month\) do nothing/);
    expect(raw).toMatch(/unnest\(p_restaurant_ids\) with ordinality/);
    expect(raw).toMatch(/subscription_status/);
    expect(raw).toMatch(/for update/);
    expect(raw).toMatch(/get diagnostics n = row_count/);
    expect(sql).toMatch(/security invoker/);
    expect(sql).not.toMatch(/security definer/);
    expect(sql).toMatch(/revoke all on function public\.generate_challenge_cycle\(uuid, date, uuid, uuid\[\]\)/);
    expect(sql).toMatch(/from public, anon, authenticated, service_role/);
    expect(sql).toMatch(/drop index if exists public\.idx_redemptions_token_hash/);
    expect(sql).toMatch(/redemptions_token_hash_key/);
    expect(sql).toMatch(/swap_count_used set not null/);
    expect(readdirSync(path.join(ROOT, 'supabase/tests'))).toContain('g10-challenge-tx.sql');
  });

  it('wires generate, swap, and issue through the RPCs with reachable retries', () => {
    const generate = source('src/lib/challenges/generate.ts');
    const swap = source('src/app/actions/swap-challenge.ts');
    const redeem = source('src/app/actions/redeem-challenge.ts');
    expect(generate).toMatch(/rpc\(\s*'generate_challenge_cycle'/);
    expect(generate).toMatch(/isCompleteCurrentLayout/);
    expect(generate).not.toMatch(/\.insert\(\{\s*user_id: userId/);
    expect(swap).toMatch(/rpc\('swap_challenge_item'/);
    expect(swap).toMatch(/isValidSuccessorLineage/);
    expect(swap).not.toMatch(/status: 'swapped_out'/);
    expect(redeem).toMatch(/rpc\(\s*'issue_challenge_redemption'/);
    expect(redeem).toMatch(/status === 'redeemed'/);
    expect(redeem).toMatch(/TOKEN_ATTEMPTS/);
    expect(redeem).toMatch(/outcome === 'created'/);
    expect(redeem).toMatch(/captureIssueCreated/);
    expect(redeem.indexOf('if (redeemLimiter)')).toBeGreaterThan(redeem.indexOf("status === 'redeemed'"));
  });
});
