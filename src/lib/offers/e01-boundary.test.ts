import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('E01 publishing boundary', () => {
  it('keeps the E01 migration free of assignment writes', () => {
    const e01 = source('supabase/migrations/20260925011529_e01_offer_versions.sql');
    expect(e01).toMatch(/Assignment does not write challenge_items.offer_version_id/);
    const legacy = source('supabase/migrations/20260909001409_challenge_workflow_transactions.sql');
    expect(legacy).not.toMatch(/2000/);
  });

  it('does not edit verify_redemption and keeps draft save behind assertAdmin', () => {
    const verify = source('supabase/migrations/20260907174245_redemptions_verify_rpc.sql');
    expect(verify).not.toMatch(/offer_version/);
    const drafts = source('src/app/(site)/admin/offer-actions.ts');
    expect(drafts).toMatch(/assertAdmin/);
    expect(drafts).toMatch(/publish_offer_version/);
    expect(drafts).toMatch(/activate_restaurant/);
  });
});
