/**
 * Fields the member First visit card may show. The stored set is wider.
 * Missing fields are omitted, not filled in.
 */
export const MEMBER_BRIEFING_FIELDS = [
  'parking',
  'arrival',
  'what_to_expect',
  'duration',
  'attire',
  'accessibility',
] as const;

export type MemberBriefingField = (typeof MEMBER_BRIEFING_FIELDS)[number];

/** Stored first-visit fields. The member card still uses MEMBER_BRIEFING_FIELDS. */
export const BRIEFING_FIELDS = [
  ...MEMBER_BRIEFING_FIELDS,
  'vibe',
  'known_for',
  'good_for',
  'seating',
  'reservations',
] as const;

export type BriefingField = (typeof BRIEFING_FIELDS)[number];

/**
 * Researched notes Bea may read. The First visit card still uses
 * MEMBER_BRIEFING_FIELDS only.
 */
export const DISCOVER_BRIEFING_FIELDS = ['vibe', 'known_for', 'good_for', 'seating'] as const;

export type DiscoverBriefingField = (typeof DISCOVER_BRIEFING_FIELDS)[number];

export const BRIEFING_FIELD_LABELS: Record<BriefingField, string> = {
  parking: 'Parking',
  arrival: 'Arrival',
  what_to_expect: 'What to expect',
  duration: 'Typical visit',
  attire: 'Attire',
  accessibility: 'Accessibility',
  vibe: 'Vibe',
  known_for: 'Known for',
  good_for: 'Good for',
  seating: 'Seating',
  reservations: 'Reservations',
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

export function isMemberBriefingField(value: string): value is MemberBriefingField {
  return (MEMBER_BRIEFING_FIELDS as readonly string[]).includes(value);
}

export function isDiscoverBriefingField(value: string): value is DiscoverBriefingField {
  return (DISCOVER_BRIEFING_FIELDS as readonly string[]).includes(value);
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

function parseHttpsUrl(sourceUrl: string): URL | null {
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/** Same Google Maps detection the Places attribution label uses. */
function isGoogleMapsHttpsUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === 'maps.google.com') return true;
  return (host === 'google.com' || host.endsWith('.google.com')) && url.pathname.startsWith('/maps');
}

/**
 * Member-facing fact source text. Google Maps wording stays fixed for
 * Places attribution. Other https links show the host only.
 */
export function briefingSourceDisplay(sourceUrl: string): string {
  const url = parseHttpsUrl(sourceUrl);
  if (!url) return 'Source';
  if (isGoogleMapsHttpsUrl(url)) return 'Google Maps';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return 'Source';
  return `Source: ${host}`;
}

/** Link text for a fact. Google Maps wording is fixed for Places attribution. */
export function briefingSourceLabel(sourceUrl: string): 'Google Maps' | 'Source' {
  return briefingSourceDisplay(sourceUrl) === 'Google Maps' ? 'Google Maps' : 'Source';
}

export function httpsSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^https:\/\/\S+$/.test(value)) return null;
  if (value.length < 12 || value.length > 500) return null;
  return value;
}
