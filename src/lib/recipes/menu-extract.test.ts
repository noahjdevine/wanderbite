import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractMenuDishes } from '@/lib/recipes/menu-extract';

const fixtures = path.join(process.cwd(), 'src/lib/recipes/__fixtures__');

function fixture(name: string): string {
  return readFileSync(path.join(fixtures, name), 'utf8');
}

describe('menu extraction', () => {
  it('reads dish name, description, and ingredients from menu-item HTML', () => {
    const dishes = extractMenuDishes(fixture('menu-items.html'));
    expect(dishes.map((dish) => dish.name)).toEqual(['Skillet Beans', 'Citrus Herb Chicken']);
    expect(dishes[0]?.description).toContain('smoked paprika');
    expect(dishes[0]?.ingredients).toEqual(['white beans', 'smoked paprika', 'garlic', 'olive oil']);
    expect(dishes[1]?.ingredients).toContain('thyme');
  });

  it('reads a schema.org menu item', () => {
    const dishes = extractMenuDishes(fixture('menu-schema.html'));
    expect(dishes).toHaveLength(1);
    expect(dishes[0]?.name).toBe('Pepper Plate');
    expect(dishes[0]?.ingredients).toEqual(['bell pepper', 'greens', 'olive oil']);
  });

  it('reads headings and ignores nav chrome', () => {
    const dishes = extractMenuDishes(fixture('menu-headings.html'));
    expect(dishes.map((dish) => dish.name)).toEqual(['Grain Bowl', 'Pepper Plate']);
    expect(dishes[0]?.ingredients).toContain('rice');
  });

  it('keeps injected menu text as dish data', () => {
    const dishes = extractMenuDishes(fixture('menu-injection.html'));
    expect(dishes).toHaveLength(1);
    expect(dishes[0]?.description).toContain('ignore previous instructions');
    expect(dishes[0]?.description).toContain('restaurant_approved');
  });

  it('reads an operator paste without treating it as HTML', () => {
    const dishes = extractMenuDishes(
      [
        'Dish: Garden Plate',
        'Description: Roasted vegetables with lemon, herbs, and olive oil on a sheet pan.',
        'Ingredients: zucchini; lemon; herbs',
      ].join('\n'),
    );
    expect(dishes[0]?.name).toBe('Garden Plate');
    expect(dishes[0]?.ingredients).toEqual(['zucchini', 'lemon', 'herbs']);
  });
});
