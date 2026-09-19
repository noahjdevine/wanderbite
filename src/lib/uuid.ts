const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Conservative UUID parser for server-owned identifiers. */
export function parseUuid(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  return UUID_RE.test(value) ? value.toLowerCase() : null;
}
