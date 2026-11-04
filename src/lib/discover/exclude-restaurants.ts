/**
 * Drops excluded restaurant ids before a pick.
 * An empty list, ids that match nothing, or a list that would remove every
 * remaining row leaves the pool as it was.
 */
export function applyRestaurantExclusion<T extends { id: string }>(
  restaurants: readonly T[],
  excludeIds: readonly string[],
): T[] {
  if (excludeIds.length === 0) return restaurants as T[];
  const excluded = new Set(excludeIds);
  let removed = 0;
  const narrowed: T[] = [];
  for (const row of restaurants) {
    if (excluded.has(row.id)) {
      removed += 1;
      continue;
    }
    narrowed.push(row);
  }
  if (removed === 0 || narrowed.length === 0) return restaurants as T[];
  return narrowed;
}

/**
 * Replay fingerprint for an optional restaurant exclusion.
 * An empty list returns the existing canonical string unchanged.
 */
export function canonicalFilterWithExcludedRestaurants(
  canonical: string,
  excludeIds: readonly string[],
): string {
  if (excludeIds.length === 0) return canonical;
  const ids = [...new Set(excludeIds)].sort().join(',');
  return `${canonical}|excludeRestaurants=${ids}`;
}
