/**
 * G12-A document security headers. Document CSP is report-only; framing is
 * enforced with X-Frame-Options: DENY because report-only frame-ancestors
 * does not protect against clickjacking.
 */

export const CSP_REPORT_PATH = '/api/csp-report';
export const ENFORCING_CSP_HEADER = 'Content-Security-Policy';
export const REPORT_ONLY_CSP_HEADER = 'Content-Security-Policy-Report-Only';
export const REFERRER_POLICY_VALUE = 'strict-origin';
export const X_FRAME_OPTIONS_VALUE = 'DENY';

/** Powerful features omitted here on purpose: never ship camera=() / microphone=() globally. */
export const BASE_PERMISSIONS_POLICY =
  'geolocation=(), payment=(), usb=(), browsing-topics=()';

/** First-party camera/mic for future voice (E03) and receipt/QR (E07) routes. */
export const MEDIA_DEVICE_PERMISSIONS_POLICY = `camera=(self), microphone=(self), ${BASE_PERMISSIONS_POLICY}`;

export const MEDIA_DEVICE_HEADER_SOURCES = [
  '/roulette/:path*',
  '/challenges/:path*',
  '/partner/:path*',
] as const;

export type SecurityHeader = { key: string; value: string };
export type SecurityHeaderSource = { source: string; headers: SecurityHeader[] };

export type SecurityHeaderEnv = {
  nodeEnv?: string;
  supabaseUrl?: string | undefined;
  posthogHost?: string | undefined;
  sentryDsn?: string | undefined;
};

const IMAGE_HOSTS = [
  'https://images.unsplash.com',
  'https://yiajoycgiyxjvznndjge.supabase.co',
  'https://tile.openstreetmap.org',
] as const;

const STRIPE_FORM_HOSTS = [
  'https://checkout.stripe.com',
  'https://billing.stripe.com',
] as const;

function originFromUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function websocketOrigin(httpOrigin: string): string | null {
  if (httpOrigin.startsWith('https://')) {
    return `wss://${httpOrigin.slice('https://'.length)}`;
  }
  if (httpOrigin.startsWith('http://')) {
    return `ws://${httpOrigin.slice('http://'.length)}`;
  }
  return null;
}

function uniqueOrigins(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function posthogOrigins(posthogHost: string | undefined): string[] {
  const origin = originFromUrl(posthogHost) ?? 'https://us.i.posthog.com';
  const extras: string[] = [origin];
  try {
    const host = new URL(origin).host;
    if (host === 'us.i.posthog.com') extras.push('https://us-assets.i.posthog.com');
    if (host === 'eu.i.posthog.com') extras.push('https://eu-assets.i.posthog.com');
  } catch {
    extras.push('https://us-assets.i.posthog.com');
  }
  return uniqueOrigins(extras);
}

function sentryIngestOrigin(sentryDsn: string | undefined): string | null {
  return originFromUrl(sentryDsn);
}

export function buildReportOnlyDocumentCsp(env: SecurityHeaderEnv = {}): string {
  const supabaseOrigin = originFromUrl(env.supabaseUrl);
  const connect = uniqueOrigins([
    "'self'",
    supabaseOrigin,
    supabaseOrigin ? websocketOrigin(supabaseOrigin) : null,
    ...posthogOrigins(env.posthogHost),
    sentryIngestOrigin(env.sentryDsn),
    ...(env.nodeEnv === 'development'
      ? ['ws://localhost:3000', 'ws://127.0.0.1:3000']
      : []),
  ]);

  const img = uniqueOrigins(["'self'", 'data:', 'blob:', supabaseOrigin, ...IMAGE_HOSTS]);

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    `form-action 'self' ${STRIPE_FORM_HOSTS.join(' ')}`,
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img.join(' ')}`,
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `report-uri ${CSP_REPORT_PATH}`,
  ];

  return directives.join('; ');
}

function documentHeaders(env: SecurityHeaderEnv): SecurityHeader[] {
  return [
    { key: 'Referrer-Policy', value: REFERRER_POLICY_VALUE },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: X_FRAME_OPTIONS_VALUE },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Permissions-Policy', value: BASE_PERMISSIONS_POLICY },
    { key: REPORT_ONLY_CSP_HEADER, value: buildReportOnlyDocumentCsp(env) },
  ];
}

export function buildSecurityHeaderSources(
  env: SecurityHeaderEnv = {},
): SecurityHeaderSource[] {
  return [
    {
      source: '/:path*',
      headers: documentHeaders(env),
    },
    ...MEDIA_DEVICE_HEADER_SOURCES.map((source) => ({
      source,
      headers: [{ key: 'Permissions-Policy', value: MEDIA_DEVICE_PERMISSIONS_POLICY }],
    })),
  ];
}

/**
 * Mirrors Next.js `/:path*` matching used by this config: `/prefix/:path*`
 * matches `/prefix` and any nested path. Last matching source wins per header key.
 */
export function headerSourceMatches(source: string, pathname: string): boolean {
  if (!pathname.startsWith('/')) return false;
  if (source === '/:path*') return true;
  if (source.endsWith('/:path*')) {
    const prefix = source.slice(0, -'/:path*'.length);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }
  return pathname === source;
}

export function effectiveHeadersForPath(
  pathname: string,
  sources: SecurityHeaderSource[] = buildSecurityHeaderSources(),
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of sources) {
    if (!headerSourceMatches(entry.source, pathname)) continue;
    for (const header of entry.headers) {
      headers[header.key] = header.value;
    }
  }
  return headers;
}

export function hasEnforcingDocumentCsp(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'content-security-policy');
}
