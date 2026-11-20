/**
 * Drops excluded restaurant ids before a pick.
 * An empty list, or ids that match nothing, leaves the pool as it was.
 * Ids are oldest first. When that list would remove every remaining row,
 * the oldest excluded id is allowed back, then the next oldest, until one
 * row remains. The AI prompt and the random pick both use that pool, so a
 * repeat is the oldest shown place and the ask does not error.
 */
export function applyRestaurantExclusion<T extends { id: string }>(
  restaurants: readonly T[],
  excludeIds: readonly string[],
): T[] {
  if (excludeIds.length === 0 || restaurants.length === 0) return restaurants as T[];
  const excluded = new Set<string>();
  const ordered: string[] = [];
  for (const id of excludeIds) {
    if (excluded.has(id)) continue;
    excluded.add(id);
    ordered.push(id);
  }
  const narrowed = restaurants.filter((row) => !excluded.has(row.id));
  if (narrowed.length === restaurants.length) return restaurants as T[];
  if (narrowed.length > 0) return narrowed;

  const pool = new Set(restaurants.map((row) => row.id));
  const blocking = ordered.filter((id) => pool.has(id));
  for (let drop = 1; drop <= blocking.length; drop += 1) {
    const still = new Set(blocking.slice(drop));
    const allowed = restaurants.filter((row) => !still.has(row.id));
    if (allowed.length > 0) return allowed;
  }
  return restaurants as T[];
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
