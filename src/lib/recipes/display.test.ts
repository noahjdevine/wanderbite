import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_RECIPE_SEEDS } from '../../../scripts/fixtures/e05-demo-recipes';
import {
  DEMO_CONTENT_LABEL,
  formatCheckedAtChicago,
  INSPIRED_BY_UNCERTAINTY,
  inspiredByUncertainty,
  listedDietaryExclusions,
  menuParaphraseLine,
  publicMenuProvenance,
  RECIPE_TYPE_LABELS,
  recipeDietaryWarning,
} from '@/lib/recipes/display';

describe('recipe labels and checked_at', () => {
  it('uses the exact type labels and the inspired-by uncertainty line', () => {
    expect(RECIPE_TYPE_LABELS.restaurant_approved).toBe('Restaurant-approved recipe');
    expect(RECIPE_TYPE_LABELS.sourced_published).toBe('Published recipe (source linked)');
    expect(RECIPE_TYPE_LABELS.inspired_by).toBe('Inspired-by home recipe');
    expect(INSPIRED_BY_UNCERTAINTY).toBe("An at-home take, not the restaurant's recipe");
    expect(DEMO_CONTENT_LABEL).toBe('Demo content');
  });

  it('labels a public-menu inspired-by recipe as a paraphrase, not the restaurant recipe', () => {
    expect(publicMenuProvenance('public_menu')).toBe('Public menu');
    expect(publicMenuProvenance(null)).toBeNull();
    expect(menuParaphraseLine('paraphrase')).toBe(
      'The dish description is a paraphrase of the public menu, not the menu text.',
    );
    expect(menuParaphraseLine('verbatim')).toBeNull();
    expect(inspiredByUncertainty('inspired_by')).toBe(
      "An at-home take, not the restaurant's recipe",
    );
  });

  it('formats checked_at in America/Chicago for winter and summer instants', () => {
    expect(formatCheckedAtChicago(null)).toBe('Not recorded');
    expect(formatCheckedAtChicago('not-a-date')).toBe('Not recorded');
    expect(formatCheckedAtChicago('2026-01-15T18:00:00.000Z')).toMatch(
      /^Jan 15, 2026, 12:00 PM (CST|GMT-6)$/,
    );
    expect(formatCheckedAtChicago('2026-07-15T17:00:00.000Z')).toMatch(
      /^Jul 15, 2026, 12:00 PM (CDT|GMT-5)$/,
    );
  });

  it('warns on dietary overlap and does not call a recipe allergen-safe', () => {
    const warning = recipeDietaryWarning(['cheese', 'peanut'], ['vegan'], ['peanut']);
    expect(warning).toContain('cheese');
    expect(warning).toContain('vegan');
    expect(warning).toContain('overlaps an allergy you listed');
    expect(warning).toContain('This does not check allergens.');
    expect(warning?.toLowerCase()).not.toMatch(/safe/);
    expect(recipeDietaryWarning(['greens'], ['vegan'], [])).toBeNull();
    expect(listedDietaryExclusions(['vegan'], ['peanut'])).toBe(
      'Your listed dietary exclusions: vegan. Your listed allergies: peanut.',
    );
  });
});

describe('demo recipe fixture', () => {
  it('seeds only labeled inspired-by demo recipes', () => {
    expect(DEMO_RECIPE_SEEDS.length).toBeGreaterThanOrEqual(3);
    for (const recipe of DEMO_RECIPE_SEEDS) {
      expect(recipe.title.startsWith('Demo ')).toBe(true);
      expect(recipe.slug.startsWith('demo-')).toBe(true);
      expect(recipe.ingredients.length).toBeGreaterThan(0);
      expect(recipe.steps.map((step) => step.order)).toEqual(
        recipe.steps.map((_, index) => index + 1),
      );
    }
    const seed = readFileSync(path.join(process.cwd(), 'scripts/seed.ts'), 'utf8');
    expect(seed).toContain("recipe_type: 'inspired_by'");
    expect(seed).toContain("rights_basis: 'original'");
    expect(seed).toContain('is_demo: true');
    expect(seed).not.toContain('restaurant_approved');
    expect(seed).not.toContain('sourced_published');
  });
});
