/** Fisher–Yates shuffle (copy). */
export function shuffleArray<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Quick dietary filters for Wanderbite Roulette (API + UI). */
export type DietaryQuickFlag = 'dairy_free' | 'vegan' | 'halal';

export function isDietaryQuickFlag(s: string): s is DietaryQuickFlag {
  return s === 'dairy_free' || s === 'vegan' || s === 'halal';
}

export type RestaurantDietaryFields = {
  cuisine_tags: string[] | null;
  is_dairy_free?: boolean | null;
  is_vegan?: boolean | null;
  is_halal?: boolean | null;
};

/**
 * True if the restaurant satisfies every selected flag.
 * Uses boolean columns when true; otherwise falls back to cuisine_tags substrings
 * so spins work before admin backfills flags.
 */
export function restaurantMatchesDietaryQuick(
  r: RestaurantDietaryFields,
  flags: DietaryQuickFlag[]
): boolean {
  if (!flags.length) return true;
  const tags = (r.cuisine_tags ?? []).map((t) => t.toLowerCase());
  const tagHas = (sub: string) => tags.some((t) => t.includes(sub));

  for (const f of flags) {
    if (f === 'vegan') {
      if (
        r.is_vegan === true ||
        tagHas('vegan') ||
        tagHas('plant-based') ||
        tagHas('plant based')
      ) {
        continue;
      }
      return false;
    }
    if (f === 'dairy_free') {
      if (
        r.is_dairy_free === true ||
        tagHas('dairy-free') ||
        tagHas('dairy free') ||
        tagHas('no dairy') ||
        tagHas('non-dairy')
      ) {
        continue;
      }
      return false;
    }
    if (f === 'halal') {
      if (r.is_halal === true || tagHas('halal')) continue;
      return false;
    }
  }
  return true;
}
