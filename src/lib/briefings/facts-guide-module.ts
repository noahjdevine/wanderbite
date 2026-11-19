/**
 * Turns the human-edited research guide into the module the research script
 * and the Vercel content-refresh path import. No filesystem read at runtime.
 */
export function renderRestaurantFactsGuideModule(markdown: string): string {
  return [
    '/**',
    ' * Generated from Docs/research/restaurant-facts-guide.md.',
    ' * Do not edit by hand. Run `npx tsx scripts/generate-facts-guide.ts`.',
    ' */',
    `export const RESTAURANT_FACTS_GUIDE = ${JSON.stringify(markdown)};`,
    '',
  ].join('\n');
}

/** Guide text for the model, without the maintainer comment. */
export function restaurantFactsGuideForPrompt(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
