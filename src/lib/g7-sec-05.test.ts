import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPartnerRedeemScanUrl } from '@/lib/partner-redeem-url';

const ROOT = path.resolve(__dirname, '../..');
const LATEST_MIGRATION = '20260907174245_redemptions_verify_rpc.sql';

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('G7 SEC-05 source contracts', () => {
  it('keeps existing QR URLs containing ?code=', () => {
    const url = buildPartnerRedeemScanUrl('grill', 'WB-XXXXX');
    expect(url).toContain('/partner/grill/redeem?code=WB-XXXXX');
    expect(source('src/lib/partner-redeem-url.ts')).toMatch(/\?code=/);
  });

  it('does not add a new supabase migration', () => {
    const files = readdirSync(path.join(ROOT, 'supabase/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files.at(-1)).toBe(LATEST_MIGRATION);
    expect(files.some((name) => /sec-05|strip.query|g7/i.test(name))).toBe(false);
  });

  it('sets Referrer-Policy: strict-origin globally and does not add CSP', () => {
    const cfg = source('next.config.ts');
    expect(cfg).toMatch(/key:\s*"Referrer-Policy"/);
    expect(cfg).toMatch(/value:\s*"strict-origin"/);
    expect(cfg).not.toMatch(/key:\s*["']Content-Security-Policy["']/);
  });

  it('disables Sentry Replay and wires the shared scrubber on client, server, and edge', () => {
    const client = source('src/instrumentation-client.ts');
    expect(client).not.toMatch(/replayIntegration/);
    expect(client).toMatch(/replaysSessionSampleRate:\s*0/);
    expect(client).toMatch(/replaysOnErrorSampleRate:\s*0/);
    expect(client).toMatch(/beforeSend:\s*sentryBeforeSend/);
    expect(client).toMatch(/beforeSendTransaction:\s*sentryBeforeSendTransaction/);
    expect(client).toMatch(/beforeSendSpan:\s*sentryBeforeSendSpan/);
    expect(source('sentry.server.config.ts')).toMatch(/beforeSend:\s*sentryBeforeSend/);
    expect(source('sentry.edge.config.ts')).toMatch(/beforeSend:\s*sentryBeforeSend/);
  });

  it('uses PostHog before_send with autocapture and session recording off', () => {
    const ph = source('src/components/providers/posthog-provider.tsx');
    expect(ph).toMatch(/before_send:\s*posthogBeforeSend/);
    expect(ph).not.toMatch(/sanitize_properties/);
    expect(ph).toMatch(/autocapture:\s*false/);
    expect(ph).toMatch(/disable_session_recording:\s*true/);
    expect(ph).not.toMatch(/useSearchParams/);
    expect(ph).toMatch(/currentOriginPathname\(\)/);
    expect(source('src/lib/posthog-server.ts')).not.toMatch(/\$current_url/);
  });

  it('strips partner redeem codes in both login and authenticated redeem UI', () => {
    const login = source('src/app/partner/[slug]/partner-slug-login.tsx');
    const redeem = source('src/components/partner/partner-redeem-client.tsx');
    const page = source('src/app/partner/[slug]/redeem/page.tsx');
    expect(page).not.toMatch(/sessionStorage/);
    expect(login).toMatch(/persistAndStripPartnerRedeemCode/);
    expect(login).toMatch(/router\.replace\(`\/partner\/\$\{redirectSlug\}\/redeem`\)/);
    expect(login).not.toMatch(/\?code=\$\{/);
    expect(redeem).toMatch(/persistAndStripPartnerRedeemCode/);
    expect(redeem).toMatch(/takePartnerRedeemCodeForVerify/);
    const runVerify = redeem.slice(redeem.indexOf('const runVerify'));
    const consumeAt = runVerify.indexOf('consumePendingRedeemCode(slug)');
    const verifyAt = runVerify.indexOf('verifyRedemptionTokenForPartner');
    expect(consumeAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeGreaterThan(consumeAt);
  });

  it('strips auth secrets before awaiting exchange, including failed exchanges', () => {
    const reset = source('src/app/(site)/reset-password/page.tsx');
    const takeAt = reset.indexOf('takeAuthSecretsAndStripAddressBar');
    const exchangeAt = reset.indexOf('exchangeCodeForSession');
    const otpAt = reset.indexOf('verifyOtp');
    expect(takeAt).toBeGreaterThan(-1);
    expect(exchangeAt).toBeGreaterThan(takeAt);
    expect(otpAt).toBeGreaterThan(takeAt);
    expect(reset).toMatch(/stripConsumedRecoveryHash/);
    expect(reset).not.toMatch(/replaceState\(\{\}, ''/);
    expect(source('src/components/auth/recovery-redirect.tsx')).toMatch(
      /window\.location\.replace\(`\/reset-password\$\{hash\}`\)/,
    );
    expect(source('src/lib/supabase/middleware.ts')).toMatch(
      /sanitizeBrowserPath\(pathname, request\.nextUrl\.search\)/,
    );
  });
});
