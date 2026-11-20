import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  briefingSchemaMissing,
  briefingsEnabled,
  logBriefingsReadFailedOnce,
  logBriefingsUnavailableOnce,
} from '@/lib/briefings/flag';
import {
  briefingFieldOrder,
  formatBriefingChecked,
  httpsSourceUrl,
  isBriefingField,
  SAMPLE_BADGE_LABEL,
  type BriefingFact,
  type BriefingField,
  type BriefingRecord,
  type RestaurantBriefings,
  BRIEFING_FIELD_LABELS,
  DISCOVER_BRIEFING_FIELDS,
  MEMBER_BRIEFING_FIELDS,
} from '@/lib/briefings/types';

export const BRIEFING_COLUMNS =
  'id, restaurant_id, field, body, source_url, last_verified_at, status, is_sample, version';

const EMPTY: RestaurantBriefings = { byRestaurantId: {} };

type LoadOptions = {
  fields: readonly BriefingField[];
  dropSamples: boolean;
};

const MEMBER_LOAD: LoadOptions = {
  fields: MEMBER_BRIEFING_FIELDS,
  dropSamples: false,
};

const DISCOVER_LOAD: LoadOptions = {
  fields: DISCOVER_BRIEFING_FIELDS,
  dropSamples: true,
};

function isBriefingRecord(value: BriefingRecord): boolean {
  return typeof value.id === 'string' && typeof value.restaurant_id === 'string';
}

function fieldAllowed(field: string, fields: readonly BriefingField[]): field is BriefingField {
  return isBriefingField(field) && (fields as readonly string[]).includes(field);
}

function toFact(row: BriefingRecord, options: LoadOptions): BriefingFact | null {
  if (row.status !== 'active') return null;
  if (options.dropSamples && row.is_sample) return null;
  if (!fieldAllowed(row.field, options.fields)) return null;
  const text = row.body.trim();
  if (!text || text.length > 400) return null;
  const sourceUrl = httpsSourceUrl(row.source_url);
  if (!sourceUrl) return null;
  const checked = formatBriefingChecked(row.last_verified_at);
  if (!checked) return null;
  const field = row.field;
  return {
    field,
    label: BRIEFING_FIELD_LABELS[field],
    text,
    sourceUrl,
    lastVerifiedAt: row.last_verified_at,
    sampleLabel: row.is_sample ? SAMPLE_BADGE_LABEL : null,
  };
}

function prefer(current: BriefingRecord, next: BriefingRecord): BriefingRecord {
  if (next.version !== current.version) return next.version > current.version ? next : current;
  if (next.last_verified_at !== current.last_verified_at) {
    return next.last_verified_at > current.last_verified_at ? next : current;
  }
  return next.id > current.id ? next : current;
}

/**
 * Flag off returns immediately and does not query. A missing table also
 * returns nothing. Paused rows are dropped here as well as by RLS.
 */
async function loadBriefingFacts(
  restaurantIdsInput: readonly string[],
  options: LoadOptions,
): Promise<RestaurantBriefings> {
  if (!briefingsEnabled()) return EMPTY;
  const restaurantIds = [...new Set(restaurantIdsInput.filter((id) => id.length > 0))];
  if (restaurantIds.length === 0) return EMPTY;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('restaurant_briefing_facts')
    .select(BRIEFING_COLUMNS)
    .eq('status', 'active')
    .in('restaurant_id', restaurantIds);
  if (error) {
    if (briefingSchemaMissing(error)) logBriefingsUnavailableOnce();
    else logBriefingsReadFailedOnce();
    return EMPTY;
  }
  const chosen = new Map<string, BriefingRecord>();
  for (const row of (data ?? []).filter(isBriefingRecord)) {
    if (row.status !== 'active') continue;
    if (options.dropSamples && row.is_sample) continue;
    const key = `${row.restaurant_id}:${row.field}`;
    const existing = chosen.get(key);
    chosen.set(key, existing ? prefer(existing, row) : row);
  }
  const byRestaurantId: Record<string, BriefingFact[]> = {};
  for (const row of chosen.values()) {
    const fact = toFact(row, options);
    if (!fact) continue;
    const list = byRestaurantId[row.restaurant_id] ?? [];
    list.push(fact);
    byRestaurantId[row.restaurant_id] = list;
  }
  for (const list of Object.values(byRestaurantId)) {
    list.sort((a, b) => briefingFieldOrder(a.field) - briefingFieldOrder(b.field));
  }
  return { byRestaurantId };
}

/**
 * Flag off returns immediately and does not query. A missing table also
 * returns nothing so the challenge page still renders before the migration
 * is applied. Paused rows are dropped here as well as by RLS. This function
 * does not write credits, offers, visits, or call a model.
 */
export async function loadRestaurantBriefings(args: {
  restaurantIds: readonly string[];
}): Promise<RestaurantBriefings> {
  return loadBriefingFacts(args.restaurantIds, MEMBER_LOAD);
}

/**
 * Active non-sample vibe, known_for, good_for, and seating notes for Discover.
 * Same flag, query, and failure behavior as the member loader. Samples are
 * dropped before a newer sample can hide an older real note.
 */
export async function loadDiscoverBriefingFacts(args: {
  restaurantIds: readonly string[];
}): Promise<RestaurantBriefings> {
  return loadBriefingFacts(args.restaurantIds, DISCOVER_LOAD);
}
