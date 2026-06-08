/** Fisher–Yates shuffle (copy). */
export function shuffleArray<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Dietary & religion flags for Wanderbite Roulette.
 * Aligned with account `dietary_flags`; hard-filtered server-side before Claude.
 */
export type RouletteDietaryFlag =
  | 'vegetarian'
  | 'vegan'
  | 'gluten_free'
  | 'halal'
  | 'kosher'
  | 'dairy_free'
  | 'pescatarian';

/** @deprecated Use RouletteDietaryFlag */
export type DietaryQuickFlag = RouletteDietaryFlag;

const ROULETTE_DIETARY_FLAGS = new Set<RouletteDietaryFlag>([
  'vegetarian',
  'vegan',
  'gluten_free',
  'halal',
  'kosher',
  'dairy_free',
  'pescatarian',
]);

export function isRouletteDietaryFlag(s: string): s is RouletteDietaryFlag {
  return ROULETTE_DIETARY_FLAGS.has(s as RouletteDietaryFlag);
}

/** @deprecated Use isRouletteDietaryFlag */
export function isDietaryQuickFlag(s: string): s is DietaryQuickFlag {
  return isRouletteDietaryFlag(s);
}

export type RestaurantDietaryFields = {
  cuisine_tags: string[] | null;
  is_dairy_free?: boolean | null;
  is_vegan?: boolean | null;
  is_halal?: boolean | null;
};

/**
 * True if the restaurant satisfies every selected flag.
 * Uses boolean columns when set; otherwise falls back to cuisine_tags substrings.
 */
export function restaurantMatchesDietaryQuick(
  r: RestaurantDietaryFields,
  flags: RouletteDietaryFlag[]
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
    if (f === 'vegetarian') {
      if (
        r.is_vegan === true ||
        tagHas('vegetarian') ||
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
    if (f === 'gluten_free') {
      if (
        tagHas('gluten-free') ||
        tagHas('gluten free') ||
        tagHas('gf ') ||
        tagHas('celiac')
      ) {
        continue;
      }
      return false;
    }
    if (f === 'halal') {
      if (r.is_halal === true || tagHas('halal')) continue;
      return false;
    }
    if (f === 'kosher') {
      if (tagHas('kosher')) continue;
      return false;
    }
    if (f === 'pescatarian') {
      if (
        tagHas('pescatarian') ||
        tagHas('seafood') ||
        tagHas('fish') ||
        tagHas('sushi')
      ) {
        continue;
      }
      return false;
    }
  }
  return true;
}
