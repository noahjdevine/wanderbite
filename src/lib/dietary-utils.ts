// src/lib/dietary-utils.ts

/** Dietary flag → cuisine_tags that are incompatible (exclude these restaurants). */
export const INCOMPATIBLE_TAGS: Record<string, string[]> = {
  vegetarian: ['bbq', 'steakhouse', 'meat', 'burgers'],
  vegan: ['bbq', 'steakhouse', 'meat', 'burgers', 'cheese', 'eggs', 'dairy'],
  halal: ['pork', 'beer', 'wine', 'bar'],
};

/**
 * Returns the first dietary flag that conflicts with this restaurant's cuisine_tags,
 * or null if no conflict. Uses exact match (case-insensitive) for tags.
 */
export function getDietaryConflict(
  cuisineTags: string[] | null,
  dietaryFlags: string[] | null
): { flag: string; conflictingTags: string[] } | null {
  if (!dietaryFlags?.length) return null;
  if (!cuisineTags?.length) return null;

  for (const flag of dietaryFlags) {
    const lowerFlag = flag.toLowerCase();
    const forbidden = INCOMPATIBLE_TAGS[lowerFlag];

    if (forbidden?.length) {
      const conflicts = cuisineTags.filter((tag) =>
        forbidden.includes(tag.toLowerCase())
      );

      if (conflicts.length > 0) {
        return {
          flag,
          conflictingTags: conflicts.map((t) => t.toLowerCase()),
        };
      }
    }
  }
  return null;
}

/** Returns true if restaurant should be excluded due to user allergies (substring match, case-insensitive). */
export function hasAllergyConflict(
  cuisineTags: string[] | null,
  allergyFlags: string[] | null
): boolean {
  if (!allergyFlags?.length) return false;
  const tags = (cuisineTags ?? []).map((t) => t.toLowerCase());
  const allergies = allergyFlags.map((a) => a.toLowerCase());
  return tags.some((t) => allergies.some((a) => t.includes(a) || a.includes(t)));
}
