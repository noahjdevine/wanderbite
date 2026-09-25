import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('E01 publishing boundary', () => {
  it('does not call publish or withdraw from application code', () => {
    for (const rel of [
      'src/app/(site)/admin/actions.ts',
      'src/app/(site)/admin/offer-actions.ts',
      'src/app/(site)/admin/admin-client.tsx',
      'src/app/(site)/admin/offer-draft-card.tsx',
      'src/lib/challenges/generate.ts',
      'src/app/actions/swap-challenge.ts',
      'src/app/actions/partner-verify.ts',
    ]) {
      const file = source(rel);
      expect(file, rel).not.toMatch(/publish_offer_version|withdraw_offer_version/);
    }
  });

  it('leaves generate and swap SQL without a 2000-cent pair floor', () => {
    const sql = source('supabase/migrations/20260909001409_challenge_workflow_transactions.sql');
    expect(sql).not.toMatch(/2000/);
    expect(source('src/lib/challenges/generate.ts')).not.toMatch(/pairSavingsModel|below_pair_floor/);
    expect(source('src/app/actions/swap-challenge.ts')).not.toMatch(/pairSavingsModel|below_pair_floor/);
  });

  it('does not edit verify_redemption and keeps draft save behind assertAdmin', () => {
    const verify = source('supabase/migrations/20260907174245_redemptions_verify_rpc.sql');
    expect(verify).not.toMatch(/offer_version/);
    const drafts = source('src/app/(site)/admin/offer-actions.ts');
    expect(drafts).toMatch(/assertAdmin/);
    expect(source('src/app/(site)/admin/offer-draft-card.tsx')).not.toMatch(/>\s*Publish|Withdraw/);
  });
});
