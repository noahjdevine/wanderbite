import { NOTE_MAX } from '@/lib/notes/note-rules';

/**
 * Pure journal reflection checks and a Google review handoff URL.
 * Nothing here writes a database, calls a provider, or publishes a note.
 * Caps below are recommended defaults. They are not a Noah decision.
 * Length is JavaScript string length (UTF-16 code units), same as
 * `saveBiteNote` and `NOTE_MAX`.
 */

export const REFLECTION_LIMITS = {
  favorite_bite: 120,
  atmosphere: 280,
  companion_label: 40,
  unpublished_review_draft: 1500,
} as const;

export const RETURN_INTERESTS = ['yes', 'maybe', 'no'] as const;

export type ReturnInterest = (typeof RETURN_INTERESTS)[number];

export type ReflectionTextField = keyof typeof REFLECTION_LIMITS;

export type ReflectionFields = {
  favorite_bite: string | null;
  atmosphere: string | null;
  return_interest: ReturnInterest | null;
  companion_label: string | null;
  unpublished_review_draft: string | null;
};

export const REFLECTION_REFUSAL_CODES = [
  'invalid_input',
  'invalid_text',
  'too_long',
  'invalid_return_interest',
] as const;

export type ReflectionRefusalCode = (typeof REFLECTION_REFUSAL_CODES)[number];

export type ReflectionRefusal =
  | { ok: false; code: 'invalid_input' }
  | { ok: false; code: 'invalid_text' | 'too_long'; field: ReflectionTextField }
  | { ok: false; code: 'invalid_return_interest'; field: 'return_interest' };

export type ReflectionValidation =
  | { ok: true; fields: ReflectionFields }
  | ReflectionRefusal;

/** First failure wins, in this order. */
const FIELD_ORDER = [
  'favorite_bite',
  'atmosphere',
  'return_interest',
  'companion_label',
  'unpublished_review_draft',
] as const;

/** Cc covers NUL, TAB, LF, CR, DEL, and C1. Newlines are refused, not stripped. */
const CONTROL_CHARS = /\p{Cc}/u;

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,256}$/;

const WRITEREVIEW_URL = 'https://search.google.com/local/writereview';

/**
 * Hosts this helper will open. Country Google hosts are refused
 * (`disallowed_host`) until a later decision adds them.
 */
const GOOGLE_MAPS_HOSTS = new Set(['google.com', 'www.google.com', 'maps.google.com']);

const REVIEW_QUERY_KEYS = new Set([
  'review',
  'reviewtext',
  'review_text',
  'review-text',
  'comment',
  'comments',
  'draft',
  'body',
  'message',
  'rating',
  'stars',
  'note',
  'text',
]);

export const GOOGLE_HANDOFF_REFUSAL_CODES = [
  'missing_destination',
  'invalid_place_id',
  'invalid_url',
  'insecure_url',
  'disallowed_host',
] as const;

export type GoogleHandoffRefusalCode = (typeof GOOGLE_HANDOFF_REFUSAL_CODES)[number];

export type GoogleReviewHandoff =
  | { ok: true; url: string; source: 'place_id' | 'maps_url' }
  | { ok: false; code: GoogleHandoffRefusalCode };

export const PUBLISH_PLAN_REFUSAL_CODES = [
  'invalid_input',
  'invalid_rating',
  'invalid_text',
  'too_long',
  'invalid_reflection',
] as const;

export type PublishPlanRefusalCode = (typeof PUBLISH_PLAN_REFUSAL_CODES)[number];

/** Columns a later explicit publish may write on `bite_notes`. Nothing else. */
export type PublicNoteWrite = {
  note: string | null;
  rating: number;
  is_public: true;
};

export type PublicNotePublishPlan =
  | { ok: true; write: PublicNoteWrite; copiedFromReflection: false }
  | { ok: false; code: PublishPlanRefusalCode };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasControlChars(value: string): boolean {
  return CONTROL_CHARS.test(value);
}

/**
 * Trim text fields. Refuse a non-string, a control character, or a trimmed
 * value over that field's cap. Do not truncate. Empty after trim is null.
 * `return_interest` is only `yes`, `maybe`, `no`, or null. No rating and no
 * sentiment are read or returned.
 */
export function validateReflectionFields(input: unknown): ReflectionValidation {
  if (!isRecord(input)) return { ok: false, code: 'invalid_input' };

  const fields: ReflectionFields = {
    favorite_bite: null,
    atmosphere: null,
    return_interest: null,
    companion_label: null,
    unpublished_review_draft: null,
  };

  for (const field of FIELD_ORDER) {
    if (field === 'return_interest') {
      const interest = readReturnInterest(input.return_interest);
      if (interest.ok === false) return interest;
      fields.return_interest = interest.value;
      continue;
    }
    const text = readTextField(field, input[field]);
    if (text.ok === false) return text;
    fields[field] = text.value;
  }

  return { ok: true, fields };
}

function readTextField(
  field: ReflectionTextField,
  raw: unknown,
): { ok: true; value: string | null } | Extract<ReflectionRefusal, { field: ReflectionTextField }> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, code: 'invalid_text', field };
  if (hasControlChars(raw)) return { ok: false, code: 'invalid_text', field };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > REFLECTION_LIMITS[field]) {
    return { ok: false, code: 'too_long', field };
  }
  return { ok: true, value: trimmed };
}

function readReturnInterest(
  raw: unknown,
): { ok: true; value: ReturnInterest | null } | Extract<ReflectionRefusal, { code: 'invalid_return_interest' }> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string' || hasControlChars(raw)) {
    return { ok: false, code: 'invalid_return_interest', field: 'return_interest' };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!isReturnInterest(trimmed)) {
    return { ok: false, code: 'invalid_return_interest', field: 'return_interest' };
  }
  return { ok: true, value: trimmed };
}

function isReturnInterest(value: string): value is ReturnInterest {
  return (RETURN_INTERESTS as readonly string[]).includes(value);
}

function writereviewUrl(placeId: string): string {
  const params = new URLSearchParams();
  params.set('placeid', placeId);
  return `${WRITEREVIEW_URL}?${params.toString()}`;
}

function refuseHandoff(code: GoogleHandoffRefusalCode): GoogleReviewHandoff {
  return { ok: false, code };
}

/**
 * Prefer a verified place id. Otherwise accept one https Maps URL on an
 * allowed host. Never rewrite http to https. Never add review text, a
 * rating, or any query key this function did not already find on the URL.
 */
export function buildGoogleReviewHandoff(input: unknown): GoogleReviewHandoff {
  if (!isRecord(input)) return refuseHandoff('missing_destination');

  const placeRaw = input.googlePlaceId;
  if (placeRaw !== undefined && placeRaw !== null) {
    if (typeof placeRaw !== 'string') return refuseHandoff('invalid_place_id');
    if (hasControlChars(placeRaw)) return refuseHandoff('invalid_place_id');
    const placeId = placeRaw.trim();
    if (placeId) {
      if (!PLACE_ID_RE.test(placeId)) return refuseHandoff('invalid_place_id');
      return { ok: true, url: writereviewUrl(placeId), source: 'place_id' };
    }
  }

  const mapsRaw = input.mapsHttpsUrl;
  if (mapsRaw === undefined || mapsRaw === null) return refuseHandoff('missing_destination');
  if (typeof mapsRaw !== 'string') return refuseHandoff('invalid_url');
  if (hasControlChars(mapsRaw)) return refuseHandoff('invalid_url');
  const mapsUrl = mapsRaw.trim();
  if (!mapsUrl) return refuseHandoff('missing_destination');
  if (/[\s\\]/.test(mapsUrl)) return refuseHandoff('invalid_url');

  let url: URL;
  try {
    url = new URL(mapsUrl);
  } catch {
    return refuseHandoff('invalid_url');
  }

  if (url.protocol === 'http:') return refuseHandoff('insecure_url');
  if (url.protocol !== 'https:') return refuseHandoff('invalid_url');
  if (url.username || url.password || url.port || url.hash) return refuseHandoff('invalid_url');

  const host = url.hostname.toLowerCase();
  if (host === 'search.google.com') return writereviewFromUrl(url);
  if (host === 'maps.app.goo.gl') return shortMapsUrl(url);
  if (!GOOGLE_MAPS_HOSTS.has(host)) return refuseHandoff('disallowed_host');
  if (host !== 'maps.google.com' && !isMapsPath(url.pathname)) {
    return refuseHandoff('invalid_url');
  }
  if (hasReviewQuery(url)) return refuseHandoff('invalid_url');

  return { ok: true, url: canonicalUrl(url), source: 'maps_url' };
}

function isMapsPath(pathname: string): boolean {
  return pathname === '/maps' || pathname.startsWith('/maps/');
}

function hasReviewQuery(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (REVIEW_QUERY_KEYS.has(key.toLowerCase())) return true;
  }
  return false;
}

function canonicalUrl(url: URL): string {
  return `https://${url.hostname.toLowerCase()}${url.pathname}${url.search}`;
}

function writereviewFromUrl(url: URL): GoogleReviewHandoff {
  const path = url.pathname.replace(/\/$/, '');
  if (path !== '/local/writereview') return refuseHandoff('invalid_url');
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== 'placeid') return refuseHandoff('invalid_url');
  const placeId = url.searchParams.get('placeid') ?? '';
  if (!PLACE_ID_RE.test(placeId)) return refuseHandoff('invalid_url');
  return { ok: true, url: writereviewUrl(placeId), source: 'maps_url' };
}

function shortMapsUrl(url: URL): GoogleReviewHandoff {
  if (url.search || !/^\/[A-Za-z0-9_-]{4,128}$/.test(url.pathname)) {
    return refuseHandoff('invalid_url');
  }
  return { ok: true, url: canonicalUrl(url), source: 'maps_url' };
}

/**
 * Plan for an explicit publish onto `bite_notes`. Over-long public notes are
 * refused (`too_long`). They are not truncated. `fromReflection` is not copied.
 * Rating outside the integers 1–5 is `invalid_rating`. No database write.
 */
export function composePublicNotePublishPlan(input: unknown): PublicNotePublishPlan {
  if (!isRecord(input)) return { ok: false, code: 'invalid_input' };

  const rating = input.rating;
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, code: 'invalid_rating' };
  }

  const note = input.publicNote;
  if (typeof note !== 'string') return { ok: false, code: 'invalid_text' };
  if (hasControlChars(note)) return { ok: false, code: 'invalid_text' };
  const trimmed = note.trim();
  if (trimmed.length > NOTE_MAX) return { ok: false, code: 'too_long' };

  if (
    input.fromReflection !== undefined &&
    input.fromReflection !== null &&
    !isRecord(input.fromReflection)
  ) {
    return { ok: false, code: 'invalid_reflection' };
  }

  return {
    ok: true,
    write: {
      note: trimmed.length ? trimmed : null,
      rating,
      is_public: true,
    },
    copiedFromReflection: false,
  };
}
