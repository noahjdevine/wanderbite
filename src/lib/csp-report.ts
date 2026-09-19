import { originPathnameOnly } from '@/lib/sensitive-url';
import { cspReportLimiter } from '@/lib/ratelimit';

export const CSP_REPORT_MAX_BYTES = 8192;
export const CSP_REPORT_MAX_ITEMS = 5;
export const CSP_REPORT_LIMITER_TIMEOUT_MS = 2000;

export type CspReportIntakeResult = 'allow' | 'drop' | 'too_large';

export type SanitizedCspReport = {
  effectiveDirective: string | null;
  disposition: string | null;
  documentUri: string | null;
  blockedUri: string | null;
  sourceFile: string | null;
  statusCode: number | null;
  lineNumber: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

function asFiniteInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function stripUrl(value: unknown): string | null {
  const stripped = originPathnameOnly(value);
  return asTrimmedString(stripped);
}

function sanitizeOne(raw: Record<string, unknown>): SanitizedCspReport {
  const body = isRecord(raw.body) ? raw.body : raw;
  const nested = isRecord(body['csp-report']) ? body['csp-report'] : body;

  return {
    effectiveDirective:
      asTrimmedString(nested.effectiveDirective) ??
      asTrimmedString(nested['effective-directive']) ??
      asTrimmedString(nested['violated-directive']) ??
      asTrimmedString(nested.violatedDirective),
    disposition: asTrimmedString(nested.disposition),
    documentUri:
      stripUrl(nested.documentURI) ??
      stripUrl(nested['document-uri']) ??
      stripUrl(nested.documentUri) ??
      stripUrl(raw.url),
    blockedUri:
      stripUrl(nested.blockedURL) ??
      stripUrl(nested['blocked-uri']) ??
      stripUrl(nested.blockedUri),
    sourceFile: stripUrl(nested.sourceFile) ?? stripUrl(nested['source-file']),
    statusCode: asFiniteInt(nested.statusCode) ?? asFiniteInt(nested['status-code']),
    lineNumber: asFiniteInt(nested.lineNumber) ?? asFiniteInt(nested['line-number']),
  };
}

export function sanitizeCspReportPayload(raw: unknown): SanitizedCspReport[] | null {
  if (Array.isArray(raw)) {
    const items = raw.filter(isRecord).slice(0, CSP_REPORT_MAX_ITEMS).map(sanitizeOne);
    return items.length > 0 ? items : null;
  }
  if (isRecord(raw)) {
    if (isRecord(raw['csp-report']) || isRecord(raw.body) || typeof raw['effective-directive'] === 'string') {
      return [sanitizeOne(raw)];
    }
    if (typeof raw['document-uri'] === 'string' || typeof raw.documentURI === 'string') {
      return [sanitizeOne(raw)];
    }
  }
  return null;
}

export function parseCspReportBody(text: string): SanitizedCspReport[] | null {
  try {
    return sanitizeCspReportPayload(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('rate limit timeout')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Production without Redis, limiter errors, or a full bucket drop the report.
 * Development without Redis still sanitizes to the process log so local soak works.
 * Reports are never stored.
 */
export async function evaluateCspReportIntake(args: {
  byteLength: number;
  ip: string;
  nodeEnv?: string;
}): Promise<CspReportIntakeResult> {
  if (args.byteLength > CSP_REPORT_MAX_BYTES) return 'too_large';

  const production = (args.nodeEnv ?? process.env.NODE_ENV) === 'production';
  if (!isUpstashConfigured() || !cspReportLimiter) {
    return production ? 'drop' : 'allow';
  }

  try {
    const result = await withTimeout(
      cspReportLimiter.limit(`ip:${args.ip}`),
      CSP_REPORT_LIMITER_TIMEOUT_MS,
    );
    return result.success ? 'allow' : 'drop';
  } catch {
    return production ? 'drop' : 'allow';
  }
}
