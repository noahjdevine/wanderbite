/** Stored first-visit fields. Missing fields are omitted, not filled in. */
export const BRIEFING_FIELDS = [
  'parking',
  'arrival',
  'what_to_expect',
  'duration',
  'attire',
  'accessibility',
] as const;

export type BriefingField = (typeof BRIEFING_FIELDS)[number];

export const BRIEFING_FIELD_LABELS: Record<BriefingField, string> = {
  parking: 'Parking',
  arrival: 'Arrival',
  what_to_expect: 'What to expect',
  duration: 'Typical visit',
  attire: 'Attire',
  accessibility: 'Accessibility',
};

export const FIRST_VISIT_HEADING = 'First visit';

export const SAMPLE_BADGE_LABEL = 'Sample';

const CHICAGO_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export type BriefingRecord = {
  id: string;
  restaurant_id: string;
  field: string;
  body: string;
  source_url: string;
  last_verified_at: string;
  status: string;
  is_sample: boolean;
  version: number;
};

export type BriefingFact = {
  field: BriefingField;
  label: string;
  text: string;
  sourceUrl: string;
  lastVerifiedAt: string;
  sampleLabel: string | null;
};

export type RestaurantBriefings = {
  byRestaurantId: Record<string, BriefingFact[]>;
};

export function isBriefingField(value: string): value is BriefingField {
  return (BRIEFING_FIELDS as readonly string[]).includes(value);
}

export function briefingFieldOrder(field: BriefingField): number {
  return BRIEFING_FIELDS.indexOf(field);
}

/** America/Chicago calendar date. Independent of the process time zone. */
export function formatBriefingChecked(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = CHICAGO_DATE.formatToParts(at);
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  const year = parts.find((part) => part.type === 'year')?.value;
  if (!month || !day || !year) return null;
  return `${month} ${day}, ${year}`;
}

/** Link text for a fact. Google Maps wording is fixed for Places attribution. */
export function briefingSourceLabel(sourceUrl: string): 'Google Maps' | 'Source' {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return 'Source';
  }
  if (url.protocol !== 'https:') return 'Source';
  const host = url.hostname.toLowerCase();
  if (host === 'maps.google.com') return 'Google Maps';
  if ((host === 'google.com' || host.endsWith('.google.com')) && url.pathname.startsWith('/maps')) {
    return 'Google Maps';
  }
  return 'Source';
}

export function httpsSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^https:\/\/\S+$/.test(value)) return null;
  if (value.length < 12 || value.length > 500) return null;
  return value;
}
