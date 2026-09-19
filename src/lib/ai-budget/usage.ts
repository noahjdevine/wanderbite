import 'server-only';

function asNonNegInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

function ttlBreakdown(usage: Record<string, unknown>): {
  cacheWrite5m: number;
  cacheWrite1h: number;
} | null {
  const creation = usage.cache_creation;
  if (!creation || typeof creation !== 'object' || Array.isArray(creation)) return null;
  const c = creation as Record<string, unknown>;
  return {
    cacheWrite5m: asNonNegInt(c.ephemeral_5m_input_tokens),
    cacheWrite1h: asNonNegInt(c.ephemeral_1h_input_tokens),
  };
}

/**
 * Parse Anthropic Messages usage into registry usage_kind units.
 * Prefer cache TTL breakdown. Never add aggregate cache_creation_input_tokens
 * on top of the breakdown (that would double-count).
 */
export function usageUnitsFromAnthropic(usage: unknown): Record<string, number> | null {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const u = usage as Record<string, unknown>;
  if (
    !('input_tokens' in u) &&
    !('output_tokens' in u) &&
    !('cache_creation' in u) &&
    !('cache_read_input_tokens' in u)
  ) {
    return null;
  }

  const ttl = ttlBreakdown(u);
  const cacheWrite5m = ttl
    ? ttl.cacheWrite5m
    : asNonNegInt(u.cache_creation_input_tokens);
  const cacheWrite1h = ttl ? ttl.cacheWrite1h : 0;
  const units: Record<string, number> = {
    input: asNonNegInt(u.input_tokens),
    output: asNonNegInt(u.output_tokens),
    cache_read: asNonNegInt(u.cache_read_input_tokens),
  };
  if (cacheWrite5m > 0) units.cache_write_5m = cacheWrite5m;
  if (cacheWrite1h > 0) units.cache_write_1h = cacheWrite1h;
  if (Object.values(units).every((n) => n === 0)) return null;
  return units;
}

export function anthropicRequestIdFromHeaders(headers: Headers): string | null {
  return headers.get('request-id') ?? headers.get('anthropic-request-id');
}
