import type { LucideIcon } from 'lucide-react';
import {
  Fish,
  Leaf,
  MilkOff,
  ShieldCheck,
  Sprout,
  WheatOff,
} from 'lucide-react';
import { CUISINES, type CuisineId } from '@/lib/cuisines';
import type { RouletteDietaryFlag } from '@/lib/roulette-dietary';

/** Shared Wanderbite Roulette option lists — single source of truth for home + /roulette. */

export const ROULETTE_VIBES = [
  'Adventurous',
  'Comfort Food',
  'Date Night',
  'Quick Bite',
  'Special Occasion',
] as const;

export type RouletteVibe = (typeof ROULETTE_VIBES)[number];

export const ROULETTE_VIBE_PILLS: { label: string; value: RouletteVibe }[] = [
  { label: '🍕 Comfort Food', value: 'Comfort Food' },
  { label: '🥂 Date Night', value: 'Date Night' },
  { label: '🌶️ Adventurous', value: 'Adventurous' },
  { label: '⚡ Quick Bite', value: 'Quick Bite' },
  { label: '✨ Special Occasion', value: 'Special Occasion' },
];

export const ROULETTE_TIMES = ['Lunch', 'Dinner', 'Late Night'] as const;

export type RouletteTime = (typeof ROULETTE_TIMES)[number];

export const ROULETTE_PRICE_OPTIONS = [
  { value: '$', label: '$', hint: 'Budget-friendly' },
  { value: '$$', label: '$$', hint: 'Moderate' },
  { value: '$$$', label: '$$$', hint: 'Upscale' },
  { value: '$$$$', label: '$$$$', hint: 'Splurge' },
] as const;

export type RoulettePriceRange = (typeof ROULETTE_PRICE_OPTIONS)[number]['value'];

export function isRoulettePriceRange(value: string): value is RoulettePriceRange {
  return ROULETTE_PRICE_OPTIONS.some((p) => p.value === value);
}

export const ROULETTE_DIETARY_PILLS: {
  value: RouletteDietaryFlag;
  label: string;
  Icon: LucideIcon;
}[] = [
  { value: 'vegetarian', label: 'Vegetarian', Icon: Sprout },
  { value: 'vegan', label: 'Vegan', Icon: Leaf },
  { value: 'gluten_free', label: 'Gluten-Free', Icon: WheatOff },
  { value: 'halal', label: 'Halal', Icon: ShieldCheck },
  { value: 'kosher', label: 'Kosher', Icon: ShieldCheck },
  { value: 'dairy_free', label: 'Dairy-Free', Icon: MilkOff },
  { value: 'pescatarian', label: 'Pescatarian', Icon: Fish },
];

/** Positive cuisine preference (soft hint to Claude). Same IDs as account exclusions. */
export const ROULETTE_CUISINE_OPTIONS = CUISINES.map((c) => ({
  id: c.id as CuisineId,
  label: c.label,
}));

export type RouletteSpinPayload = {
  vibe?: RouletteVibe;
  timeOfDay?: RouletteTime;
  dietaryQuick?: RouletteDietaryFlag[];
  excludedCuisines?: CuisineId[];
  priceRange?: RoulettePriceRange;
  preferredCuisine?: CuisineId;
};

export function buildRouletteSpinBody(args: {
  vibe: RouletteVibe | null;
  timeOfDay: RouletteTime | null;
  dietaryFlags: RouletteDietaryFlag[];
  excludedCuisines: CuisineId[];
  priceRange: RoulettePriceRange | null;
  preferredCuisine: CuisineId | null;
}): RouletteSpinPayload {
  return {
    vibe: args.vibe ?? undefined,
    timeOfDay: args.timeOfDay ?? undefined,
    dietaryQuick: args.dietaryFlags.length > 0 ? args.dietaryFlags : undefined,
    excludedCuisines:
      args.excludedCuisines.length > 0 ? args.excludedCuisines : undefined,
    priceRange: args.priceRange ?? undefined,
    preferredCuisine: args.preferredCuisine ?? undefined,
  };
}
