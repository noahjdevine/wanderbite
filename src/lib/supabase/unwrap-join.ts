import 'server-only';

/**
 * Supabase typed clients return joined related rows as either T | T[] | null
 * depending on the relationship cardinality and PostgREST's join shape.
 * This helper picks the first row when the join returns an array, or returns
 * the row directly when the join returns a single object.
 *
 * Use this instead of `as unknown as { foo: ... }` casts at row-mapping sites.
 */
export function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}
