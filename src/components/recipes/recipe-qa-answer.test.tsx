import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipeCardModel } from '@/lib/recipes/display';
import { GENERATED_HOME_RECIPE_LABEL } from '@/lib/recipes/display';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/app/actions/save-recipe', () => ({
  setSavedRecipe: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { RecipeQaAnswer } from '@/components/recipes/recipe-qa-answer';

function card(): RecipeCardModel {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'demo-skillet-beans',
    title: 'Demo skillet beans',
    recipeType: 'inspired_by',
    typeLabel: 'Inspired-by home recipe',
    restaurantId: '22222222-2222-4222-8222-222222222222',
    servings: 2,
    estMinutes: 25,
    ingredients: [{ name: 'Demo beans', quantity: '1', unit: 'cup' }],
    steps: [{ order: 1, text: 'Stir the demo beans.' }],
    substitutions: [],
    dietaryTags: ['greens'],
    description: null,
    sourceUrl: 'https://example.com/beans',
    sourceName: 'Demo source',
    sourceKind: null,
    provenanceLabel: null,
    retrievedAtLabel: 'Jan 15, 2026, 12:00 PM CST',
    paraphraseLine: null,
    rightsBasis: 'original',
    checkedAtLabel: 'Jan 15, 2026, 12:00 PM CST',
    version: 1,
    isDemo: true,
    demoLabel: 'Demo content',
    uncertaintyLine: "An at-home take, not the restaurant's recipe",
    dietaryWarning: null,
    saved: false,
  };
}

describe('recipe Q&A answer', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders a saved card and a generated recipe without a save button', () => {
    act(() => {
      root.render(
        <RecipeQaAnswer
          qa={{
            answer: 'Inspired-by home recipe. Checked Jan 15, 2026, 12:00 PM CST.',
            notice: 'The assistant is over its AI budget, so these are the recipe cards only.',
            recipes: [card()],
            generatedLabel: GENERATED_HOME_RECIPE_LABEL,
            generatedText: 'Ingredients: something invented.',
            visitLines: ['Hours are not in the catalog. Confirm hours with the restaurant.'],
          }}
        />,
      );
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Inspired-by home recipe');
    expect(text).toContain('Demo content');
    expect(text).toContain('Jan 15, 2026, 12:00 PM CST');
    expect(text).toContain('Save recipe');
    expect(text).toContain(GENERATED_HOME_RECIPE_LABEL);
    expect(text).toContain('Hours are not in the catalog.');
    const generated = container.querySelector('article[class*="border-dashed"]');
    expect(generated?.textContent).toContain(GENERATED_HOME_RECIPE_LABEL);
    expect(generated?.textContent).not.toContain('Save recipe');
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });
});
