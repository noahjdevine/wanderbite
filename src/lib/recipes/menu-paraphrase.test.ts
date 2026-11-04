import { describe, expect, it } from 'vitest';
import { claimsAllergenSafe, descriptionCopiesMenu } from '@/lib/recipes/menu-paraphrase';

const MENU = 'White beans simmered with smoked paprika, garlic, and olive oil until the sauce turns glossy.';

describe('paraphrase overlap', () => {
  it('rejects an exact menu description and a long shared run', () => {
    expect(descriptionCopiesMenu(MENU, MENU, MENU)).toBe(true);
    const copied = 'White beans simmered with smoked paprika, garlic, and then finished at home.';
    expect(descriptionCopiesMenu(copied, MENU, MENU)).toBe(true);
  });

  it('keeps a short paraphrase that does not reuse a six-word run', () => {
    const paraphrase = 'A home pot of beans warmed with paprika and garlic.';
    expect(descriptionCopiesMenu(paraphrase, MENU, MENU)).toBe(false);
  });

  it('rejects allergen-safe claims', () => {
    expect(claimsAllergenSafe('This dish is allergen-safe for your table.')).toBe(true);
    expect(claimsAllergenSafe('This does not check allergens.')).toBe(false);
  });
});
