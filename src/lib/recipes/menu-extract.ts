import { Window } from 'happy-dom';

type MenuDocument = Window['document'];
type MenuElement = NonNullable<ReturnType<MenuDocument['querySelector']>>;

export type ExtractedDish = {
  name: string;
  description: string;
  ingredients: string[];
};

const SCAN_CAP = 40;
const PROSE_CAP = 500;

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function stripPrice(name: string): string {
  return name.replace(/\s+\$?\d+(?:\.\d{2})?\s*$/, '').trim();
}

function splitList(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 80);
}

function clip(text: string): string {
  return text.length > PROSE_CAP ? text.slice(0, PROSE_CAP).trim() : text;
}

function dish(name: string, description: string, ingredients: string[]): ExtractedDish | null {
  const cleanedName = stripPrice(clean(name));
  const cleanedDescription = clip(clean(description).replace(/^description:\s*/i, ''));
  const uniqueIngredients = [...new Set(ingredients.map((item) => clean(item)).filter(Boolean))].slice(0, 20);
  if (!cleanedName || cleanedName.length > 160) return null;
  if (cleanedDescription.length < 15 && uniqueIngredients.length === 0) return null;
  if (cleanedDescription === cleanedName) return null;
  return {
    name: cleanedName,
    description: cleanedDescription,
    ingredients: uniqueIngredients,
  };
}

function ingredientsFrom(el: MenuElement): string[] {
  const listed = [...el.querySelectorAll('[itemprop="recipeIngredient"], .ingredients li, ul li, ol li')].flatMap(
    (node) => {
      const text = clean(node.textContent);
      return text.length > 0 && text.length <= 80 ? [text] : [];
    },
  );
  for (const paragraph of el.querySelectorAll('p')) {
    const text = clean(paragraph.textContent);
    if (/^ingredients?\b/i.test(text)) {
      listed.push(...splitList(text.replace(/^ingredients?\s*:?\s*/i, '')));
    }
  }
  return listed;
}

function dishFromItem(el: MenuElement): ExtractedDish | null {
  const nameNode = el.querySelector('[itemprop="name"], h1, h2, h3, h4, .name');
  const descriptionNode = el.querySelector('[itemprop="description"], .description, p');
  const name = clean(nameNode?.textContent);
  let description = clean(descriptionNode?.textContent);
  if (/^ingredients?\b/i.test(description)) description = '';
  return dish(name, description, ingredientsFrom(el));
}

function headingDishes(document: MenuDocument): ExtractedDish[] {
  const found: ExtractedDish[] = [];
  for (const heading of document.querySelectorAll('h2, h3, h4')) {
    if (heading.closest('nav, header, footer')) continue;
    const name = clean(heading.textContent);
    let description = '';
    const ingredients: string[] = [];
    let sibling = heading.nextElementSibling;
    while (sibling && !/^H[234]$/.test(sibling.tagName)) {
      if (sibling.tagName === 'UL' || sibling.tagName === 'OL') {
        ingredients.push(...ingredientsFrom(sibling));
      } else {
        const text = clean(sibling.textContent);
        if (/^ingredients?\b/i.test(text)) ingredients.push(...splitList(text.replace(/^ingredients?\s*:?\s*/i, '')));
        else if (!description) description = text;
      }
      sibling = sibling.nextElementSibling;
    }
    const parsed = dish(name, description, ingredients);
    if (parsed) found.push(parsed);
    if (found.length >= SCAN_CAP) break;
  }
  return found;
}

function mount(html: string): Window {
  const window = new Window({
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      enableJavaScriptEvaluation: false,
    },
  });
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const documentHtml = /<html[\s>]/i.test(stripped)
    ? stripped
    : `<!doctype html><html><body>${stripped}</body></html>`;
  window.document.write(documentHtml);
  return window;
}

function extractHtml(html: string): ExtractedDish[] {
  const window = mount(html);
  try {
    const document = window.document;
    const candidates = [...document.querySelectorAll('[itemtype], [class], [id]')].filter((el) => {
      const itemtype = el.getAttribute('itemtype') ?? '';
      const marker = `${el.getAttribute('class') ?? ''} ${el.id}`;
      return /menuitem/i.test(itemtype) || /menu[-_\s]?item|\bdish\b|menu-entry/i.test(marker);
    });
    const items = candidates.filter((el) => !candidates.some((parent) => parent !== el && parent.contains(el)));
    const fromItems = items.flatMap((el) => {
      const parsed = dishFromItem(el);
      return parsed ? [parsed] : [];
    });
    const found = fromItems.length > 0 ? fromItems : headingDishes(document);
    return dedupe(found).slice(0, SCAN_CAP);
  } finally {
    window.close();
  }
}

function extractPasted(text: string): ExtractedDish[] {
  const blocks = text.split(/\n\s*\n/);
  const found: ExtractedDish[] = [];
  for (const block of blocks) {
    let name = '';
    let description = '';
    const ingredients: string[] = [];
    for (const line of block.split(/\n/)) {
      const dishLine = /^dish:\s*(.+)$/i.exec(line.trim());
      const descriptionLine = /^description:\s*(.+)$/i.exec(line.trim());
      const ingredientLine = /^ingredients:\s*(.+)$/i.exec(line.trim());
      if (dishLine?.[1]) name = dishLine[1];
      else if (descriptionLine?.[1]) description = descriptionLine[1];
      else if (ingredientLine?.[1]) ingredients.push(...splitList(ingredientLine[1]));
    }
    const parsed = dish(name, description, ingredients);
    if (parsed) found.push(parsed);
  }
  return dedupe(found).slice(0, SCAN_CAP);
}

function dedupe(dishes: ExtractedDish[]): ExtractedDish[] {
  const seen = new Set<string>();
  const unique: ExtractedDish[] = [];
  for (const item of dishes) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

/**
 * Reads one HTML page or one pasted menu. Does not follow links.
 * Menu prose is untrusted data for the model prompt, not instructions.
 */
export function extractMenuDishes(input: string): ExtractedDish[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (/<[a-z!/]/i.test(trimmed)) return extractHtml(trimmed);
  return extractPasted(trimmed);
}

export function menuProse(dish: ExtractedDish): string {
  return [dish.name, dish.description].filter(Boolean).join('. ');
}
