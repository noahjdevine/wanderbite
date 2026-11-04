/**
 * Distinct `restaurants.neighborhood` values.
 * Blank and whitespace-only names do not count. Comparison is the trimmed
 * string, so " Downtown " and "Downtown" are one neighborhood.
 * `getMemberProgress` and the passport map both use this count.
 */
export function distinctNeighborhoods(
  names: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function countDistinctNeighborhoods(
  names: readonly (string | null | undefined)[],
): number {
  return distinctNeighborhoods(names).length;
}
