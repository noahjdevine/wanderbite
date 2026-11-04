/**
 * Clearly labeled demo home recipes for the McKinney rows in scripts/seed.ts.
 * inspired_by only. These are not restaurant-approved recipes.
 */
export type DemoRecipeSeed = {
  restaurantName: string;
  slug: string;
  title: string;
  servings: number;
  estMinutes: number;
  ingredients: { name: string; quantity: string; unit: string }[];
  steps: { order: number; text: string }[];
  substitutions: { instead_of: string; use: string }[];
  dietaryTags: string[];
  checkedAt: string;
};

export const DEMO_RECIPE_SOURCE_NAME = 'Wanderbite demo collection';

export const DEMO_RECIPE_SEEDS: readonly DemoRecipeSeed[] = [
  {
    restaurantName: 'Hutchins BBQ',
    slug: 'demo-hutchins-skillet-beans',
    title: 'Demo skillet beans',
    servings: 4,
    estMinutes: 35,
    ingredients: [
      { name: 'Demo white beans', quantity: '2', unit: 'cup' },
      { name: 'Demo onion', quantity: '1', unit: 'whole' },
      { name: 'Demo smoked paprika', quantity: '1', unit: 'tsp' },
    ],
    steps: [
      { order: 1, text: 'Warm the demo onion in a skillet until soft.' },
      { order: 2, text: 'Stir in the demo beans and paprika and heat through.' },
    ],
    substitutions: [{ instead_of: 'Demo white beans', use: 'Demo lentils' }],
    dietaryTags: ['bbq', 'meat'],
    checkedAt: '2026-01-15T18:00:00.000Z',
  },
  {
    restaurantName: 'The Yard',
    slug: 'demo-yard-grain-bowl',
    title: 'Demo grain bowl',
    servings: 2,
    estMinutes: 25,
    ingredients: [
      { name: 'Demo rice', quantity: '1', unit: 'cup' },
      { name: 'Demo cheese', quantity: '2', unit: 'tbsp' },
      { name: 'Demo herbs', quantity: '1', unit: 'handful' },
    ],
    steps: [
      { order: 1, text: 'Warm the demo rice.' },
      { order: 2, text: 'Top it with the demo cheese and herbs.' },
    ],
    substitutions: [{ instead_of: 'Demo cheese', use: 'Demo pumpkin seeds' }],
    dietaryTags: ['cheese'],
    checkedAt: '2026-01-15T18:00:00.000Z',
  },
  {
    restaurantName: 'Local Yocal BBQ & Grill',
    slug: 'demo-local-yocal-pepper-plate',
    title: 'Demo pepper plate',
    servings: 2,
    estMinutes: 20,
    ingredients: [
      { name: 'Demo bell pepper', quantity: '2', unit: 'whole' },
      { name: 'Demo greens', quantity: '2', unit: 'cup' },
      { name: 'Demo olive oil', quantity: '1', unit: 'tbsp' },
    ],
    steps: [
      { order: 1, text: 'Slice the demo peppers.' },
      { order: 2, text: 'Toss them with the demo greens and oil.' },
    ],
    substitutions: [{ instead_of: 'Demo bell pepper', use: 'Demo zucchini' }],
    dietaryTags: ['greens'],
    checkedAt: '2026-07-15T17:00:00.000Z',
  },
];
