import { formatCheckedAtChicago } from '@/lib/recipes/display';
import type { Json } from '@/types/database.types';

export const EVIDENCE_EXCERPT_MAX = 240;

export const PIPELINE_FIELDS = ['description', 'ingredients', 'price'] as const;

export type PipelineField = (typeof PIPELINE_FIELDS)[number];

export type DescriptionFactValue = {
  dish: string;
  text: string;
  menu_description: string;
  ingredients: string[];
  price: string | null;
};

export type DescriptionFact = {
  id: string;
  sourceId: string;
  subjectId: string;
  version: number;
  status: 'current' | 'superseded' | 'pending_review' | 'rejected';
  dish: string;
  text: string;
  menuDescription: string;
  ingredients: string[];
  price: string | null;
  evidenceExcerpt: string;
};

export function evidenceExcerpt(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const clipped = cleaned.slice(0, EVIDENCE_EXCERPT_MAX).trim();
  return clipped.length > 0 ? clipped : 'source page';
}

export function descriptionFactValue(fact: Pick<
  DescriptionFact,
  'dish' | 'text' | 'menuDescription' | 'ingredients' | 'price'
>): DescriptionFactValue {
  return {
    dish: fact.dish,
    text: fact.text,
    menu_description: fact.menuDescription,
    ingredients: fact.ingredients,
    price: fact.price,
  };
}

function asRecord(value: Json): Record<string, Json | undefined> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

export function readDescriptionFact(row: {
  id: string;
  source_id: string;
  subject_id: string | null;
  version: number;
  status: string;
  value: Json;
  evidence_excerpt: string;
}): DescriptionFact | null {
  if (!row.subject_id) return null;
  if (row.status !== 'current' && row.status !== 'superseded' && row.status !== 'pending_review' && row.status !== 'rejected') {
    return null;
  }
  const value = asRecord(row.value);
  if (!value) return null;
  const dish = typeof value.dish === 'string' ? value.dish.trim() : '';
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  const menuDescription = typeof value.menu_description === 'string' ? value.menu_description.trim() : '';
  if (!dish || !text) return null;
  const ingredients = Array.isArray(value.ingredients)
    ? value.ingredients.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []))
    : [];
  const price = typeof value.price === 'string' && value.price.trim() ? value.price.trim() : null;
  return {
    id: row.id,
    sourceId: row.source_id,
    subjectId: row.subject_id,
    version: row.version,
    status: row.status,
    dish,
    text,
    menuDescription,
    ingredients,
    price,
    evidenceExcerpt: row.evidence_excerpt,
  };
}

/** Chicago wall time for operator listings. Independent of the process timezone. */
export function formatContentInstant(iso: string | null | undefined): string {
  return formatCheckedAtChicago(iso);
}
