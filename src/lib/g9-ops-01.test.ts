import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const MIGRATION = 'supabase/migrations/20260908194148_stripe_events_webhook_outbox.sql';

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('G9 OPS-01 stripe ledger (source)', () => {
  it('uses a forward-only M6 with ledger, outbox, and claim fencing', () => {
    const raw = source(MIGRATION);
    const sql = raw.replace(/--[^\n]*/g, '').replace(/\$\$[\s\S]*?\$\$/g, ' FUNCTION_BODY ');
    expect(source('supabase/migrations/001_initial_schema.sql')).not.toMatch(/stripe_events/);
    expect(sql).not.toMatch(/^\s*(begin|start\s+transaction|commit|rollback)\b/im);
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '30s'");
    expect(sql).toMatch(/create table public\.stripe_events/);
    expect(sql).toMatch(/create table public\.webhook_outbox/);
    expect(sql).toMatch(/effect_key text primary key/);
    expect(sql).toMatch(/claim_token uuid/);
    expect(sql).toMatch(/available_at timestamptz/);
    expect(sql).toMatch(/status in \('received', 'processing', 'processed', 'failed'\)/);
    expect(sql).toMatch(/status in \('pending', 'processing', 'sent', 'failed'\)/);
    expect(raw).toMatch(/status in \('received', 'failed'\)/);
    expect(raw).toMatch(/status = 'processing' and claimed_at < now\(\) - interval '5 minutes'/);
    expect(sql).toMatch(/security invoker/);
    expect(sql).not.toMatch(/security definer/);
    expect(sql).toMatch(/revoke all on table public\.stripe_events/);
    expect(sql).toMatch(/revoke all on table public\.webhook_outbox/);
    expect(sql).toMatch(/grant select, insert, update on table public\.stripe_events to service_role/);
    expect(sql).toMatch(/add column if not exists stripe_subscription_id text/);
    expect(sql).toMatch(/'trialing'/);
    expect(sql).toMatch(/stripe_subscription_id is null/);
    expect(raw).toMatch(/new\.stripe_subscription_id is distinct from old\.stripe_subscription_id/);
    expect(readdirSync(path.join(ROOT, 'supabase/tests'))).toContain('g9-ledger.sql');
  });

  it('keeps membership in the webhook and delivery in the outbox worker', () => {
    const webhook = source('src/app/api/webhooks/stripe/route.ts');
    const worker = source('src/app/api/cron/webhook-outbox/route.ts');
    const process = source('src/lib/stripe-webhook.ts');
    const resend = source('src/lib/resend.tsx');
    const checkout = source('src/app/actions/stripe.ts');
    const generate = source('src/lib/challenges/generate.ts');
    const vercel = source('vercel.json');

    expect(webhook).toMatch(/handleStripeWebhookEvent/);
    expect(webhook).not.toMatch(/sendSubscriptionConfirmationEmail/);
    expect(webhook).not.toMatch(/captureEvent/);
    expect(process).toMatch(/enqueue_webhook_outbox/);
    expect(process).toMatch(/subscription-confirmation\//);
    expect(process).not.toMatch(/sendSubscriptionConfirmationEmail/);
    expect(worker).toMatch(/processWebhookOutbox/);
    expect(worker).toMatch(/verifyCronAuth/);
    expect(resend).toMatch(/idempotencyKey/);
    expect(resend).toMatch(/error \|\| !data/);
    expect(checkout).toMatch(/client_reference_id: auth\.userId/);
    expect(checkout).toMatch(/subscription_data: \{ metadata: \{ userId: auth\.userId \} \}/);
    expect(generate).toMatch(/subscription_status !== 'active'/);
    expect(vercel).toMatch(/\/api\/cron\/webhook-outbox/);
  });
});
