import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BASE_PERMISSIONS_POLICY,
  ENFORCING_CSP_HEADER,
  MEDIA_DEVICE_PERMISSIONS_POLICY,
  REPORT_ONLY_CSP_HEADER,
  X_FRAME_OPTIONS_VALUE,
  buildReportOnlyDocumentCsp,
  buildSecurityHeaderSources,
  effectiveHeadersForPath,
  hasEnforcingDocumentCsp,
  headerSourceMatches,
} from '@/lib/security-headers';
import {
  CSP_REPORT_MAX_BYTES,
  evaluateCspReportIntake,
  parseCspReportBody,
} from '@/lib/csp-report';

const ROOT = path.resolve(__dirname, '../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

const NESTED_MEDIA_PATHS = [
  '/roulette',
  '/roulette/preview',
  '/challenges',
  '/challenges/show/abc-123',
  '/partner',
  '/partner/grill/redeem',
] as const;

const NON_MEDIA_PATHS = ['/', '/pricing', '/signin', '/billing', '/journey'] as const;

describe('G12-A header source matching', () => {
  it('matches Next.js /:path* and nested :path* prefixes', () => {
    expect(headerSourceMatches('/:path*', '/')).toBe(true);
    expect(headerSourceMatches('/:path*', '/partner/grill/redeem')).toBe(true);
    expect(headerSourceMatches('/partner/:path*', '/partner')).toBe(true);
    expect(headerSourceMatches('/partner/:path*', '/partner/grill/redeem')).toBe(true);
    expect(headerSourceMatches('/challenges/:path*', '/challenges/show/x')).toBe(true);
    expect(headerSourceMatches('/partner/:path*', '/pricing')).toBe(false);
    expect(headerSourceMatches('/challenges/:path*', '/challenge')).toBe(false);
  });
});

describe('G12-A effective document headers', () => {
  const sources = buildSecurityHeaderSources({
    nodeEnv: 'production',
    supabaseUrl: 'https://yiajoycgiyxjvznndjge.supabase.co',
    posthogHost: 'https://us.i.posthog.com',
    sentryDsn: 'https://abc@o123.ingest.us.sentry.io/1',
  });

  it.each(NON_MEDIA_PATHS)('applies DENY framing and report-only CSP on %s', (pathname) => {
    const headers = effectiveHeadersForPath(pathname, sources);
    expect(headers['X-Frame-Options']).toBe(X_FRAME_OPTIONS_VALUE);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers[REPORT_ONLY_CSP_HEADER]).toBeTruthy();
    expect(headers[ENFORCING_CSP_HEADER]).toBeUndefined();
    expect(hasEnforcingDocumentCsp(headers)).toBe(false);
    expect(headers['Permissions-Policy']).toBe(BASE_PERMISSIONS_POLICY);
    expect(headers['Permissions-Policy']).not.toMatch(/camera=\(\)/);
    expect(headers['Permissions-Policy']).not.toMatch(/microphone=\(\)/);
  });

  it.each(NESTED_MEDIA_PATHS)(
    'overrides Permissions-Policy to first-party camera/mic on %s without dropping framing',
    (pathname) => {
      const headers = effectiveHeadersForPath(pathname, sources);
      expect(headers['X-Frame-Options']).toBe(X_FRAME_OPTIONS_VALUE);
      expect(headers[REPORT_ONLY_CSP_HEADER]).toBeTruthy();
      expect(headers[ENFORCING_CSP_HEADER]).toBeUndefined();
      expect(headers['Permissions-Policy']).toBe(MEDIA_DEVICE_PERMISSIONS_POLICY);
      expect(headers['Permissions-Policy']).toMatch(/camera=\(self\)/);
      expect(headers['Permissions-Policy']).toMatch(/microphone=\(self\)/);
      expect(headers['Permissions-Policy']).not.toMatch(/camera=\(\)/);
      expect(headers['Permissions-Policy']).not.toMatch(/microphone=\(\)/);
    },
  );

  it('keeps last-source override from winning over global DENY on nested partner routes', () => {
    const partner = effectiveHeadersForPath('/partner/grill/redeem', sources);
    const challenges = effectiveHeadersForPath('/challenges/show/item-1', sources);
    expect(partner['X-Frame-Options']).toBe('DENY');
    expect(challenges['X-Frame-Options']).toBe('DENY');
    expect(partner['Permissions-Policy']).not.toBe(
      effectiveHeadersForPath('/pricing', sources)['Permissions-Policy'],
    );
  });
});

describe('G12-A report-only document CSP', () => {
  const csp = buildReportOnlyDocumentCsp({
    nodeEnv: 'production',
    supabaseUrl: 'https://yiajoycgiyxjvznndjge.supabase.co',
    posthogHost: 'https://us.i.posthog.com',
    sentryDsn: 'https://abc@o123.ingest.us.sentry.io/1',
  });

  it('does not allow Anthropic or other model providers in the browser', () => {
    expect(csp).not.toMatch(/anthropic/i);
    expect(csp).not.toMatch(/api\.openai\.com/);
    expect(csp).toMatch(/connect-src[^;]*'self'/);
    expect(csp).toMatch(/https:\/\/yiajoycgiyxjvznndjge\.supabase\.co/);
    expect(csp).toMatch(/wss:\/\/yiajoycgiyxjvznndjge\.supabase\.co/);
    expect(csp).toMatch(/https:\/\/us\.i\.posthog\.com/);
    expect(csp).toMatch(/https:\/\/o123\.ingest\.us\.sentry\.io/);
  });

  it('allows Stripe portal/checkout navigation and first-party maps/images', () => {
    expect(csp).toMatch(/form-action 'self' https:\/\/checkout\.stripe\.com https:\/\/billing\.stripe\.com/);
    expect(csp).toMatch(/tile\.openstreetmap\.org/);
    expect(csp).not.toMatch(/lh3\.googleusercontent\.com/);
    expect(csp).not.toMatch(/maps\.googleapis\.com/);
    expect(csp).toMatch(/report-uri \/api\/csp-report/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
  });

  it('keeps development websocket extras out of production CSP', () => {
    expect(csp).not.toMatch(/ws:\/\/localhost:3000/);
    const dev = buildReportOnlyDocumentCsp({ nodeEnv: 'development' });
    expect(dev).toMatch(/ws:\/\/localhost:3000/);
    expect(dev).toMatch(/ws:\/\/127\.0\.0\.1:3000/);
  });

  it('is wired from next.config without an enforcing document CSP key', () => {
    const cfg = source('next.config.ts');
    expect(cfg).toMatch(/buildSecurityHeaderSources/);
    expect(cfg).toMatch(/contentSecurityPolicy:\s*"default-src 'self'; script-src 'none'; sandbox;"/);
    expect(cfg).not.toMatch(/key:\s*["']Content-Security-Policy["']/);
    expect(source('src/lib/ratelimit.ts')).toMatch(/wanderbite:csp-report-ip/);
  });
});

describe('G12-A CSP report sanitization and intake', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('strips query strings and drops script samples from legacy reports', () => {
    const reports = parseCspReportBody(
      JSON.stringify({
        'csp-report': {
          'document-uri': 'https://wanderbite.co/partner/grill/redeem?code=WB-XXXXX',
          'blocked-uri': 'https://evil.example/hook?token_hash=abc',
          'effective-directive': 'script-src',
          'script-sample': 'alert(document.cookie)',
          'original-policy': "default-src 'self'; report-uri /api/csp-report?code=secret",
          'source-file': 'https://wanderbite.co/assets/app.js?code=1',
          'line-number': 12,
          'status-code': 200,
        },
      }),
    );
    expect(reports).toEqual([
      {
        effectiveDirective: 'script-src',
        disposition: null,
        documentUri: 'https://wanderbite.co/partner/grill/redeem',
        blockedUri: 'https://evil.example/hook',
        sourceFile: 'https://wanderbite.co/assets/app.js',
        statusCode: 200,
        lineNumber: 12,
      },
    ]);
    expect(JSON.stringify(reports)).not.toMatch(/WB-XXXXX|token_hash|script-sample|original-policy/);
  });

  it('sanitizes Reporting API batches and caps item count', () => {
    const batch = Array.from({ length: 8 }, (_, i) => ({
      type: 'csp-violation',
      url: `https://wanderbite.co/challenges/show/${i}?code=WB-1`,
      body: {
        effectiveDirective: 'connect-src',
        blockedURL: 'https://api.anthropic.com/v1/messages',
        sample: 'should-not-keep',
      },
    }));
    const reports = parseCspReportBody(JSON.stringify(batch));
    expect(reports).toHaveLength(5);
    expect(reports?.[0]?.documentUri).toBe('https://wanderbite.co/challenges/show/0');
    expect(reports?.[0]?.blockedUri).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.stringify(reports)).not.toContain('should-not-keep');
    expect(JSON.stringify(reports)).not.toContain('WB-1');
  });

  it('returns null for malformed JSON', () => {
    expect(parseCspReportBody('{nope')).toBeNull();
    expect(parseCspReportBody('"string"')).toBeNull();
  });

  it('rejects oversized bodies and drops production reports without Redis', async () => {
    expect(
      await evaluateCspReportIntake({
        byteLength: CSP_REPORT_MAX_BYTES + 1,
        ip: '203.0.113.10',
        nodeEnv: 'production',
      }),
    ).toBe('too_large');

    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    expect(
      await evaluateCspReportIntake({
        byteLength: 12,
        ip: '203.0.113.10',
        nodeEnv: 'production',
      }),
    ).toBe('drop');
    expect(
      await evaluateCspReportIntake({
        byteLength: 12,
        ip: '203.0.113.10',
        nodeEnv: 'development',
      }),
    ).toBe('allow');
  });
});
