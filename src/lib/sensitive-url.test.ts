import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureResult } from 'posthog-js';
import {
  hashLooksLikeRecoverySession,
  originPathnameOnly,
  readAuthSecretsFromSearch,
  sanitizeBrowserPath,
  stripConsumedRecoveryHash,
  stripSensitiveParamsFromAddressBar,
  takeAuthSecretsAndStripAddressBar,
} from '@/lib/sensitive-url';
import { posthogBeforeSend } from '@/lib/posthog-before-send';
import {
  scrubSentryEvent,
  scrubSentrySpan,
} from '@/lib/sentry-scrub';

function capture(overrides: Partial<CaptureResult> = {}): CaptureResult {
  return {
    uuid: '00000000-0000-4000-8000-000000000001',
    event: '$pageview',
    properties: {},
    ...overrides,
  };
}

describe('browser URL sanitizer', () => {
  beforeEach(() => {
    window.history.replaceState({ keep: true }, '', '/partner/grill/redeem?code=WB-XXXXX&ok=1');
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('removes only sensitive query params and preserves history.state', () => {
    stripSensitiveParamsFromAddressBar();
    expect(window.location.pathname).toBe('/partner/grill/redeem');
    expect(window.location.search).toBe('?ok=1');
    expect(window.history.state).toEqual({ keep: true });
  });

  it('strips code and token_hash before a successful or failed exchange', () => {
    window.history.replaceState({ keep: true }, '', '/reset-password?code=pkce-secret&type=recovery');
    const first = takeAuthSecretsAndStripAddressBar();
    expect(first.code).toBe('pkce-secret');
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/reset-password');
    expect(window.history.state).toEqual({ keep: true });

    window.history.replaceState(
      { keep: true },
      '',
      '/reset-password?token_hash=otp-secret&type=recovery',
    );
    const second = takeAuthSecretsAndStripAddressBar();
    expect(second.tokenHash).toBe('otp-secret');
    expect(window.location.search).toBe('');
  });

  it('removes a consumed recovery hash while preserving history.state', () => {
    window.history.replaceState(
      { keep: true },
      '',
      '/reset-password#access_token=tok&type=recovery&expires_in=3600',
    );
    expect(hashLooksLikeRecoverySession(window.location.hash)).toBe(true);
    stripConsumedRecoveryHash();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/reset-password');
    expect(window.history.state).toEqual({ keep: true });
  });
});

describe('sanitizeBrowserPath', () => {
  it('keeps harmless params and companion type when no secret is present', () => {
    expect(sanitizeBrowserPath('/billing', '?session=xyz')).toBe('/billing?session=xyz');
    expect(sanitizeBrowserPath('/reset-password', '?type=recovery')).toBe(
      '/reset-password?type=recovery',
    );
    expect(sanitizeBrowserPath('/challenges', '?code=secret&checkout=success')).toBe(
      '/challenges?checkout=success',
    );
  });
});

describe('originPathnameOnly', () => {
  it('drops every query and fragment from absolute URLs', () => {
    expect(originPathnameOnly('https://wanderbite.co/partner/x/redeem?code=WB-1#frag')).toBe(
      'https://wanderbite.co/partner/x/redeem',
    );
  });

  it('does not rewrite arbitrary non-URL strings', () => {
    expect(originPathnameOnly('not a url')).toBe('not a url');
    expect(originPathnameOnly(12)).toBe(12);
  });
});

describe('readAuthSecretsFromSearch', () => {
  it('copies secrets without treating type as globally secret', () => {
    expect(readAuthSecretsFromSearch('?code=abc&type=recovery')).toEqual({
      code: 'abc',
      tokenHash: null,
    });
  });
});

describe('PostHog before_send', () => {
  it('scrubs pageview and pageleave URL fields and leaves $referring_domain', () => {
    const pageview = posthogBeforeSend(
      capture({
        event: '$pageview',
        properties: {
          $current_url: 'https://wanderbite.co/partner/x/redeem?code=WB-1',
          $referrer: 'https://maps.google.com/search?q=secret',
          $referring_domain: 'maps.google.com',
          restaurant: 'https://example.com/place?code=keep-this-string',
        },
      }),
    );
    expect(pageview?.properties.$current_url).toBe('https://wanderbite.co/partner/x/redeem');
    expect(pageview?.properties.$referrer).toBe('https://maps.google.com/search');
    expect(pageview?.properties.$referring_domain).toBe('maps.google.com');
    expect(pageview?.properties.restaurant).toBe('https://example.com/place?code=keep-this-string');

    const pageleave = posthogBeforeSend(
      capture({
        event: '$pageleave',
        properties: {
          $current_url: 'https://wanderbite.co/reset-password?code=pkce#access_token=tok',
        },
      }),
    );
    expect(pageleave?.properties.$current_url).toBe('https://wanderbite.co/reset-password');
  });
});

describe('Sentry scrubbers', () => {
  it('scrubs error request, breadcrumbs, and URL-shaped transactions', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://wanderbite.co/partner/x/redeem?code=WB-1',
        query_string: 'code=WB-1',
      },
      transaction: 'https://wanderbite.co/auth/callback?code=pkce',
      breadcrumbs: [
        { data: { url: '/challenges?code=secret', note: 'https://example.com?code=plain' } },
      ],
    });
    expect(event.request?.url).toBe('https://wanderbite.co/partner/x/redeem');
    expect(event.request?.query_string).toBe('');
    expect(event.transaction).toBe('https://wanderbite.co/auth/callback');
    expect(event.breadcrumbs?.[0]?.data?.url).toBe('/challenges');
    expect(event.breadcrumbs?.[0]?.data?.note).toBe('https://example.com?code=plain');
  });

  it('scrubs transactions and span URL fields', () => {
    const tx = scrubSentryEvent({
      request: { url: 'https://wanderbite.co/a?token_hash=x', query_string: { token_hash: 'x' } },
    });
    expect(tx.request?.url).toBe('https://wanderbite.co/a');
    expect(tx.request?.query_string).toBe('');

    const span = scrubSentrySpan({
      description: 'https://wanderbite.co/partner/x/redeem?code=WB-1',
      data: {
        'http.url': 'https://wanderbite.co/partner/x/redeem?code=WB-1',
        restaurant: 'https://example.com?code=keep',
      },
    });
    expect(span.description).toBe('https://wanderbite.co/partner/x/redeem');
    expect(span.data?.['http.url']).toBe('https://wanderbite.co/partner/x/redeem');
    expect(span.data?.restaurant).toBe('https://example.com?code=keep');
  });
});

describe('takeAuthSecretsAndStripAddressBar failure path', () => {
  it('strips the URL even when the caller later treats the exchange as failed', async () => {
    window.history.replaceState({}, '', '/reset-password?code=pkce-secret&type=recovery');
    const exchange = vi.fn().mockRejectedValue(new Error('exchange failed'));
    const secrets = takeAuthSecretsAndStripAddressBar();
    expect(window.location.search).toBe('');
    await expect(exchange(secrets.code)).rejects.toThrow('exchange failed');
    expect(window.location.search).toBe('');
  });
});
