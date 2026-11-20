import { clipChars } from '@/lib/ai-bounds';
import {
  BRIEFING_FIELD_LABELS,
  DISCOVER_BRIEFING_FIELDS,
  formatBriefingChecked,
  httpsSourceUrl,
  type BriefingFact,
  type DiscoverBriefingField,
} from '@/lib/briefings/types';

/** Card order. At most two are shown. Seating stays off the card. */
export const DISCOVER_CARD_FACT_FIELDS = ['known_for', 'vibe', 'good_for'] as const;

export type DiscoverCardFactField = (typeof DISCOVER_CARD_FACT_FIELDS)[number];

export const DISCOVER_CARD_FACT_LIMIT = 2;

/** Prompt bodies stay short. The card still shows the stored sentence. */
export const DISCOVER_PROMPT_FACT_CHARS = 120;

export const DISCOVER_FACT_PROMPT_NOTE =
  'Some rows include researched notes in facts. You may use them to match the request. A missing fact is unknown, not a no. Do not invent hours, noise, availability, or allergy safety.';

export type DiscoverCardFact = {
  field: DiscoverCardFactField;
  label: string;
  text: string;
  sourceUrl: string;
  lastVerifiedAt: string;
};

export type DiscoverPromptFacts = Partial<Record<DiscoverBriefingField, string>>;

function isCardField(value: string): value is DiscoverCardFactField {
  return (DISCOVER_CARD_FACT_FIELDS as readonly string[]).includes(value);
}

function usableFact(fact: BriefingFact): fact is BriefingFact & { field: DiscoverBriefingField } {
  if (fact.sampleLabel) return false;
  if (!(DISCOVER_BRIEFING_FIELDS as readonly string[]).includes(fact.field)) return false;
  const text = fact.text.trim();
  if (!text || text.length > 400) return false;
  if (!httpsSourceUrl(fact.sourceUrl)) return false;
  if (!formatBriefingChecked(fact.lastVerifiedAt)) return false;
  return true;
}

/** Known for, then Vibe, then Good for. Missing lines are skipped. */
export function discoverCardFacts(facts: readonly BriefingFact[]): DiscoverCardFact[] {
  const byField = new Map<DiscoverCardFactField, BriefingFact>();
  for (const fact of facts) {
    if (!usableFact(fact) || !isCardField(fact.field)) continue;
    if (!byField.has(fact.field)) byField.set(fact.field, fact);
  }
  const shown: DiscoverCardFact[] = [];
  for (const field of DISCOVER_CARD_FACT_FIELDS) {
    const fact = byField.get(field);
    if (!fact) continue;
    shown.push({
      field,
      label: BRIEFING_FIELD_LABELS[field],
      text: fact.text.trim(),
      sourceUrl: fact.sourceUrl,
      lastVerifiedAt: fact.lastVerifiedAt,
    });
    if (shown.length === DISCOVER_CARD_FACT_LIMIT) break;
  }
  return shown;
}

/**
 * Accepts the card payload, including a stream value that is not an array.
 * Reorders and caps the same way as discoverCardFacts.
 */
export function presentDiscoverCardFacts(value: unknown): DiscoverCardFact[] {
  if (!Array.isArray(value)) return [];
  const facts: BriefingFact[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Partial<DiscoverCardFact>;
    if (typeof row.field !== 'string' || !isCardField(row.field)) continue;
    if (typeof row.text !== 'string' || typeof row.sourceUrl !== 'string') continue;
    if (typeof row.lastVerifiedAt !== 'string') continue;
    facts.push({
      field: row.field,
      label: BRIEFING_FIELD_LABELS[row.field],
      text: row.text,
      sourceUrl: row.sourceUrl,
      lastVerifiedAt: row.lastVerifiedAt,
      sampleLabel: null,
    });
  }
  return discoverCardFacts(facts);
}

/** Capped note strings for one prompt row. Undefined when the row has none. */
export function discoverPromptFacts(facts: readonly BriefingFact[]): DiscoverPromptFacts | undefined {
  const record: DiscoverPromptFacts = {};
  for (const field of DISCOVER_BRIEFING_FIELDS) {
    const fact = facts.find((item) => item.field === field);
    if (!fact || !usableFact(fact)) continue;
    const text = clipChars(fact.text.trim(), DISCOVER_PROMPT_FACT_CHARS);
    if (!text) continue;
    record[field] = text;
  }
  return Object.keys(record).length > 0 ? record : undefined;
}
