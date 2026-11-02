import { createHash } from 'node:crypto';
import { addMonths } from 'date-fns';
import { offerVersionCoversDeadline } from '@/lib/challenges/challenge-deadline';
import { CUISINES } from '@/lib/cuisines';
import { haversineMiles } from '@/lib/launch-market';
import { offerVersionTermsProblem, type OfferVersionTerms } from '@/lib/offers/catalog-conversion';
import { slugify } from '@/lib/slugify';

export const CATALOG_IMPORT_PLAN_SCHEMA = 'wanderbite.catalog_import_plan.v1';
export const TEST_OFFER_SOURCE = 'catalog-import --test-offers';
/** Append-only marker. `offer.publish` rows are never updated. */
export const TEST_OFFER_MARK_ACTION = 'offer.test_mark';
/** Legacy marker. Publish rows are not updated; older ones may already carry `is_test: true`. */
export const TEST_OFFER_PUBLISH_ACTION = 'offer.publish';
export const TEST_OFFER_AUDIT_TARGET_TYPE = 'offer_version';
export const TEST_OFFER_AUDIT_ACTIONS = [TEST_OFFER_MARK_ACTION, TEST_OFFER_PUBLISH_ACTION] as const;

/**
 * Test-offer audit match used by `--withdraw-test-offers` and the v2 supply snapshot.
 * A row matches when `target_type` is `offer_version`, `is_test` is boolean true, and
 * `action` is `offer.test_mark` or legacy `offer.publish`.
 */
export function isTestOfferAuditMarker(row: {
  action: string;
  targetType: string;
  isTest: unknown;
}): boolean {
  return (
    row.targetType === TEST_OFFER_AUDIT_TARGET_TYPE &&
    row.isTest === true &&
    (row.action === TEST_OFFER_MARK_ACTION || row.action === TEST_OFFER_PUBLISH_ACTION)
  );
}
export const DEFAULT_TEST_OFFER_CAPACITY = 50;
export const TEST_OFFER_BASE_CENTS = 1000;
const TEST_OFFER_THRESHOLD_FLOOR_CENTS = 4000;
const OUTSIDE_MARKET_KM = 50;
const KM_PER_MILE = 1.609344;
const ASSIGNMENT_WINDOW_MS = 840 * 60 * 60 * 1000;
const MAX_TEXT = 500;

const COLUMNS = [
  'market_slug',
  'market_name',
  'market_state',
  'market_timezone',
  'name',
  'slug',
  'address',
  'city',
  'zip',
  'lat',
  'lon',
  'google_place_id',
  'cuisine_tags',
  'is_vegan',
  'is_dairy_free',
  'is_halal',
  'price_range',
  'neighborhood',
  'status',
  'base_discount_cents',
  'capacity_max_redemptions',
  'valid_from',
  'valid_until',
  'is_test_offer',
] as const;

type ColumnName = (typeof COLUMNS)[number];
const COLUMN_SET = new Set<string>(COLUMNS);

const CUISINE_TAGS = new Map<string, string>();
for (const cuisine of CUISINES) {
  CUISINE_TAGS.set(cuisine.id, cuisine.id);
  for (const keyword of cuisine.keywords) {
    CUISINE_TAGS.set(keyword.toLowerCase(), keyword.toLowerCase());
  }
}

export type CoordinateProvenance = 'provided' | 'places:place_id' | 'places:address' | 'preserved';

export type CatalogMessage = {
  line: number | null;
  lines?: number[];
  market_slug: string | null;
  message: string;
};

export type CatalogOfferInput = {
  base_discount_cents: number | null;
  capacity_max_redemptions: number | null;
  valid_from: string | null;
  valid_until: string | null;
  is_test_offer: boolean;
};

export type CatalogImportRow = {
  line: number;
  market_slug: string;
  market_name: string | null;
  market_state: string | null;
  market_timezone: string | null;
  name: string;
  slug: string | null;
  address: string;
  city: string;
  zip: string;
  lat: number | null;
  lon: number | null;
  google_place_id: string | null;
  cuisine_tags: string[];
  is_vegan: boolean;
  is_dairy_free: boolean;
  is_halal: boolean;
  price_range: string | null;
  neighborhood: string | null;
  status: 'active' | 'paused';
  offer: CatalogOfferInput | null;
};

export type CatalogDbMarket = {
  id: string;
  slug: string;
  name: string;
  state: string | null;
  timezone: string | null;
  status: string | null;
};

export type CatalogDbRestaurant = {
  id: string;
  market_id: string | null;
  name: string;
  slug: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  google_place_id: string | null;
  cuisine_tags: string[] | null;
  is_vegan: boolean;
  is_dairy_free: boolean;
  is_halal: boolean;
  price_range: string | null;
  neighborhood: string | null;
  status: string | null;
  current_offer_version_id: string | null;
  challenge_item_count: number;
  offer_version_count: number;
};

export type CatalogTestOfferRef = {
  version_id: string;
  restaurant_id: string;
  market_slug: string;
};

export type CatalogDbSnapshot = {
  markets: CatalogDbMarket[];
  restaurants: CatalogDbRestaurant[];
  test_offers: CatalogTestOfferRef[];
};

export type CatalogRestaurantWrite = {
  name: string;
  slug: string;
  address: string;
  lat: number;
  lon: number;
  google_place_id: string | null;
  cuisine_tags: string[] | null;
  is_vegan: boolean;
  is_dairy_free: boolean;
  is_halal: boolean;
  price_range: string | null;
  neighborhood: string | null;
  status: 'active' | 'paused';
};

export type CatalogRestaurantPatch = {
  name?: string;
  slug?: string;
  address?: string;
  lat?: number;
  lon?: number;
  google_place_id?: string | null;
  cuisine_tags?: string[] | null;
  is_vegan?: boolean;
  is_dairy_free?: boolean;
  is_halal?: boolean;
  price_range?: string | null;
  neighborhood?: string | null;
  status?: 'active' | 'paused';
};

export type CatalogPlanAction =
  | {
      kind: 'create_market';
      slug: string;
      name: string;
      state: string;
      timezone: string;
      country: 'US';
      currency: 'USD';
      status: 'active';
    }
  | {
      kind: 'create_restaurant';
      market_slug: string;
      restaurant: CatalogRestaurantWrite;
      coordinate_provenance: CoordinateProvenance;
    }
  | {
      kind: 'update_restaurant';
      restaurant_id: string;
      market_slug: string;
      slug: string;
      patch: CatalogRestaurantPatch;
      coordinate_provenance: CoordinateProvenance;
    }
  | {
      kind: 'pause_duplicate';
      restaurant_id: string;
      market_slug: string;
      slug: string;
      keep_slug: string;
      method: 'retire_restaurant' | 'direct_pause';
    }
  | {
      kind: 'publish_offer';
      market_slug: string;
      restaurant_slug: string;
      restaurant_id: string | null;
      terms: OfferVersionTerms;
      exclusions: { exclude_tax: true; exclude_tip: true; categories: string[] };
      is_test: boolean;
      source: string;
    }
  | {
      kind: 'withdraw_test_offer';
      market_slug: string;
      restaurant_id: string;
      version_id: string;
    };

export type CatalogPossibleDuplicate = {
  market_slug: string;
  left_slug: string;
  right_slug: string;
  reason: 'google_place_id' | 'name_address' | 'slug_suffix';
};

export type CatalogPlanCounts = {
  create: number;
  update: number;
  unchanged: number;
  skipped: number;
  errors: number;
  pause: number;
  publish: number;
  withdraw: number;
  market_create: number;
  warnings: number;
};

export type CatalogPlan = {
  schema: typeof CATALOG_IMPORT_PLAN_SCHEMA;
  created_at: string;
  source_label: string;
  accepted: boolean;
  mode: 'import' | 'withdraw';
  markets: string[];
  snapshot_hash: string;
  counts: CatalogPlanCounts;
  by_market: Record<string, CatalogPlanCounts>;
  warnings: CatalogMessage[];
  errors: CatalogMessage[];
  skipped: CatalogMessage[];
  possible_duplicates: CatalogPossibleDuplicate[];
  refused_real_offers: CatalogRefusedRealOffer[];
  actions: CatalogPlanAction[];
};

export type CatalogRefusedRealOffer = {
  line: number | null;
  market_slug: string;
  slug: string;
};

export type CatalogPlanOptions = {
  skipInvalid: boolean;
  refreshCoordinates: boolean;
  testOffers: boolean;
  testOffersAllInMarket: boolean;
  publishRealOffers: boolean;
  testOfferCapacity: number;
  resolveDuplicates: ReadonlyArray<{ keep: string; drop: string }>;
  withdrawTestOffers: boolean;
  markets: readonly string[];
  now: Date;
  sourceLabel: string;
  outboundDisabled: boolean;
  apiKeyPresent: boolean;
};

export type GeocodeRequest =
  | { kind: 'place_id'; placeId: string }
  | { kind: 'address'; query: string };

export type GeocodeResult = { lat: number; lon: number } | { error: string };
export type Geocoder = (request: GeocodeRequest) => Promise<GeocodeResult>;

export type GeocodeCache = {
  v: 1;
  entries: Record<string, { lat: number; lon: number }>;
};

export type CatalogCliArgs = {
  mode: 'plan' | 'apply' | 'from-db';
  file: string | null;
  planFile: string | null;
  planOutput: string;
  actor: string | null;
  confirm: string[];
  skipInvalid: boolean;
  refreshCoordinates: boolean;
  testOffers: boolean;
  testOffersAllInMarket: boolean;
  publishRealOffers: boolean;
  withdrawTestOffers: boolean;
  testOfferCapacity: number;
  resolveDuplicates: { keep: string; drop: string }[];
  markets: string[];
  fromDbMarket: string | null;
  format: 'csv' | 'json' | null;
};

export const DEFAULT_PLAN_OUTPUT = '.supply-gate/catalog-import-plan.json';
export const DEFAULT_EXCLUSIONS = {
  exclude_tax: true,
  exclude_tip: true,
  categories: [] as string[],
};

function offerExclusions(): { exclude_tax: true; exclude_tip: true; categories: string[] } {
  return {
    exclude_tax: true,
    exclude_tip: true,
    categories: [...DEFAULT_EXCLUSIONS.categories],
  };
}

type ParsedDocument = { rows: CatalogImportRow[]; errors: CatalogMessage[] };

function emptyCounts(): CatalogPlanCounts {
  return {
    create: 0,
    update: 0,
    unchanged: 0,
    skipped: 0,
    errors: 0,
    pause: 0,
    publish: 0,
    withdraw: 0,
    market_create: 0,
    warnings: 0,
  };
}

function addCounts(target: CatalogPlanCounts, key: keyof CatalogPlanCounts, amount = 1): void {
  target[key] += amount;
}

function bump(
  total: CatalogPlanCounts,
  byMarket: Record<string, CatalogPlanCounts>,
  market: string | null,
  key: keyof CatalogPlanCounts,
): void {
  addCounts(total, key);
  const bucket = market ?? '(none)';
  const row = byMarket[bucket] ?? emptyCounts();
  addCounts(row, key);
  byMarket[bucket] = row;
}

export function emptyGeocodeCache(): GeocodeCache {
  return { v: 1, entries: {} };
}

export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function addCalendarMonthsUtc(instant: Date, months: number): Date {
  const wall = new Date(
    instant.getUTCFullYear(),
    instant.getUTCMonth(),
    instant.getUTCDate(),
    instant.getUTCHours(),
    instant.getUTCMinutes(),
    instant.getUTCSeconds(),
    instant.getUTCMilliseconds(),
  );
  const shifted = addMonths(wall, months);
  return new Date(
    Date.UTC(
      shifted.getFullYear(),
      shifted.getMonth(),
      shifted.getDate(),
      shifted.getHours(),
      shifted.getMinutes(),
      shifted.getSeconds(),
      shifted.getMilliseconds(),
    ),
  );
}

export function buildTestOfferTerms(args: {
  now: Date;
  timezone: string;
  capacityMaxRedemptions: number;
  baseDiscountCents?: number;
  validFrom?: string | null;
  validUntil?: string | null;
}): OfferVersionTerms {
  const base = args.baseDiscountCents ?? TEST_OFFER_BASE_CENTS;
  return {
    tiers: [{ threshold_cents: Math.max(base, TEST_OFFER_THRESHOLD_FLOOR_CENTS), discount_cents: base }],
    boosts: [],
    timezone: args.timezone,
    valid_from: args.validFrom ?? args.now.toISOString(),
    valid_until: args.validUntil ?? addCalendarMonthsUtc(args.now, 12).toISOString(),
    capacity_timezone: args.timezone,
    capacity_window_kind: 'calendar_month',
    capacity_max_redemptions: args.capacityMaxRedemptions,
  };
}

export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function zipFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const matches = address.match(/\b\d{5}(?:-\d{4})?\b/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1]?.slice(0, 5) ?? null;
}

export function nameAddressKey(name: string, address: string): string {
  return `${normalizeMatchText(name)}|${normalizeMatchText(address)}`;
}

export function nameAddressZipKey(name: string, address: string, zip: string): string {
  return `${nameAddressKey(name, address)}|${zip}`;
}

function sameCoord(left: number | null | undefined, right: number | null | undefined): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(left - right) <= 1e-6;
}

function sameTags(left: string[] | null | undefined, right: string[]): boolean {
  const a = [...(left ?? [])].map((tag) => tag.toLowerCase()).sort();
  const b = [...right].map((tag) => tag.toLowerCase()).sort();
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

function linesPhrase(lines: number[]): string {
  const unique = [...new Set(lines)].sort((a, b) => a - b);
  if (unique.length === 1) return `line ${unique[0]}`;
  if (unique.length === 2) return `lines ${unique[0]} and ${unique[1]}`;
  const head = unique.slice(0, -1).join(', ');
  return `lines ${head}, and ${unique[unique.length - 1]}`;
}

function parseBool(raw: string): { ok: true; value: boolean | null } | { ok: false } {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: true, value: null };
  if (value === 'true' || value === 'yes' || value === '1') return { ok: true, value: true };
  if (value === 'false' || value === 'no' || value === '0') return { ok: true, value: false };
  return { ok: false };
}

function parseOptionalNumber(raw: string): { ok: true; value: number | null } | { ok: false } {
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: parsed };
}

function parseOptionalInt(raw: string): { ok: true; value: number | null } | { ok: false } {
  const parsed = parseOptionalNumber(raw);
  if (!parsed.ok) return parsed;
  if (parsed.value == null) return parsed;
  if (!Number.isInteger(parsed.value)) return { ok: false };
  return parsed;
}

function cell(record: Record<string, string>, key: ColumnName): string {
  return record[key] ?? '';
}

function cuisineTagsFromText(raw: string): { ok: true; tags: string[] } | { ok: false; tag: string } {
  const parts = raw
    .split('|')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const tags: string[] = [];
  for (const part of parts) {
    const canonical = CUISINE_TAGS.get(part);
    if (!canonical) return { ok: false, tag: part };
    if (!tags.includes(canonical)) tags.push(canonical);
  }
  return { ok: true, tags };
}

function rowFromRecord(
  record: Record<string, string>,
  line: number,
  errors: CatalogMessage[],
): CatalogImportRow | null {
  const marketSlug = cell(record, 'market_slug').trim().toLowerCase();
  const name = cell(record, 'name').trim();
  const address = cell(record, 'address').trim();
  const city = cell(record, 'city').trim();
  const zip = cell(record, 'zip').trim();
  const rowErrors: string[] = [];
  if (!marketSlug) rowErrors.push('market_slug is required');
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(marketSlug)) rowErrors.push('market_slug is not a slug');
  if (!name) rowErrors.push('name is required');
  if (!address) rowErrors.push('address is required');
  if (!city) rowErrors.push('city is required');
  if (!/^\d{5}$/.test(zip)) rowErrors.push('zip must be a 5-digit US ZIP');
  if (name.length > MAX_TEXT || address.length > MAX_TEXT || city.length > MAX_TEXT) {
    rowErrors.push('text field is too long');
  }

  const slugRaw = cell(record, 'slug').trim().toLowerCase();
  let slug: string | null = null;
  if (slugRaw) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugRaw)) rowErrors.push('slug is not a slug');
    else slug = slugRaw;
  }

  const latParsed = parseOptionalNumber(cell(record, 'lat'));
  const lonParsed = parseOptionalNumber(cell(record, 'lon'));
  if (!latParsed.ok || !lonParsed.ok) rowErrors.push('lat and lon must be numbers');
  const lat = latParsed.ok ? latParsed.value : null;
  const lon = lonParsed.ok ? lonParsed.value : null;
  if ((lat == null) !== (lon == null)) rowErrors.push('lat and lon must both be set or both be empty');
  if (lat != null && (lat < -90 || lat > 90)) rowErrors.push('lat is outside [-90, 90]');
  if (lon != null && (lon < -180 || lon > 180)) rowErrors.push('lon is outside [-180, 180]');

  const timezone = cell(record, 'market_timezone').trim();
  if (timezone && !isIanaTimeZone(timezone)) rowErrors.push('market_timezone is not an IANA time zone');

  const statusRaw = cell(record, 'status').trim().toLowerCase();
  let status: 'active' | 'paused' = 'active';
  if (!statusRaw) status = 'active';
  else if (statusRaw === 'active' || statusRaw === 'paused') status = statusRaw;
  else rowErrors.push('status must be active or paused');

  const place = cell(record, 'google_place_id').trim();
  if (place && !/^[A-Za-z0-9_-]+$/.test(place)) rowErrors.push('google_place_id has unexpected characters');

  const tags = cuisineTagsFromText(cell(record, 'cuisine_tags'));
  if (!tags.ok) rowErrors.push(`cuisine tag ${tags.tag} is not in the cuisine list`);

  const vegan = parseBool(cell(record, 'is_vegan'));
  const dairy = parseBool(cell(record, 'is_dairy_free'));
  const halal = parseBool(cell(record, 'is_halal'));
  const testOffer = parseBool(cell(record, 'is_test_offer'));
  if (!vegan.ok) rowErrors.push('is_vegan must be true or false');
  if (!dairy.ok) rowErrors.push('is_dairy_free must be true or false');
  if (!halal.ok) rowErrors.push('is_halal must be true or false');
  if (!testOffer.ok) rowErrors.push('is_test_offer must be true or false');

  const base = parseOptionalInt(cell(record, 'base_discount_cents'));
  const capacity = parseOptionalInt(cell(record, 'capacity_max_redemptions'));
  if (!base.ok) rowErrors.push('base_discount_cents must be an integer');
  if (!capacity.ok) rowErrors.push('capacity_max_redemptions must be an integer');
  const validFrom = cell(record, 'valid_from').trim();
  const validUntil = cell(record, 'valid_until').trim();
  if (validFrom && Number.isNaN(Date.parse(validFrom))) rowErrors.push('valid_from is not a timestamp');
  if (validUntil && Number.isNaN(Date.parse(validUntil))) rowErrors.push('valid_until is not a timestamp');

  const offerTouched = Boolean(
    (base.ok && base.value != null) ||
      (capacity.ok && capacity.value != null) ||
      validFrom ||
      validUntil ||
      (testOffer.ok && testOffer.value === true),
  );

  if (rowErrors.length > 0) {
    for (const message of rowErrors) {
      errors.push({ line, market_slug: marketSlug || null, message });
    }
    return null;
  }

  return {
    line,
    market_slug: marketSlug,
    market_name: cell(record, 'market_name').trim() || null,
    market_state: cell(record, 'market_state').trim() || null,
    market_timezone: timezone || null,
    name,
    slug,
    address,
    city,
    zip,
    lat,
    lon,
    google_place_id: place || null,
    cuisine_tags: tags.ok ? tags.tags : [],
    is_vegan: vegan.ok ? (vegan.value ?? false) : false,
    is_dairy_free: dairy.ok ? (dairy.value ?? false) : false,
    is_halal: halal.ok ? (halal.value ?? false) : false,
    price_range: cell(record, 'price_range').trim() || null,
    neighborhood: cell(record, 'neighborhood').trim() || null,
    status,
    offer: offerTouched
      ? {
          base_discount_cents: base.ok ? base.value : null,
          capacity_max_redemptions: capacity.ok ? capacity.value : null,
          valid_from: validFrom || null,
          valid_until: validUntil || null,
          is_test_offer: testOffer.ok ? (testOffer.value ?? false) : false,
        }
      : null,
  };
}

function parseCsvTable(text: string): { rows: { line: number; cells: string[] }[] } | { error: string } {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const table: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let value = '';
  let quoted = false;
  let line = 1;
  let cellLine = 1;
  const pushRow = () => {
    cells.push(value);
    value = '';
    if (cells.some((entry) => entry.trim() !== '')) table.push({ line: cellLine, cells });
    cells = [];
    cellLine = line;
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') line += 1;
        value += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      cells.push(value);
      value = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      line += 1;
      pushRow();
      cellLine = line;
      continue;
    }
    value += char;
  }
  if (quoted) return { error: 'catalog import CSV has an unterminated quote' };
  if (value.length > 0 || cells.length > 0) pushRow();
  return { rows: table };
}

function recordsFromCsv(text: string): { ok: true; records: { line: number; record: Record<string, string> }[] } | { ok: false; message: string } {
  const table = parseCsvTable(text);
  if ('error' in table) return { ok: false, message: table.error };
  const header = table.rows[0];
  if (!header) return { ok: false, message: 'catalog import file is empty' };
  const names = header.cells.map((entry) => entry.trim());
  const unknown = names.filter((name) => !COLUMN_SET.has(name));
  if (unknown.length > 0) return { ok: false, message: `catalog import unknown column ${unknown[0]}` };
  for (const required of ['market_slug', 'name', 'address', 'city', 'zip'] as const) {
    if (!names.includes(required)) return { ok: false, message: `catalog import missing column ${required}` };
  }
  const records = table.rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    names.forEach((name, index) => {
      record[name] = row.cells[index] ?? '';
    });
    return { line: row.line, record };
  });
  return { ok: true, records };
}

function jsonLineRecords(raw: unknown): { ok: true; records: { line: number; record: Record<string, string> }[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: 'catalog import JSON must be an array' };
  if (raw.length === 0) return { ok: false, message: 'catalog import file is empty' };
  const records: { line: number; record: Record<string, string> }[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, message: `catalog import JSON row ${index + 1} is not an object` };
    }
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (!COLUMN_SET.has(key)) return { ok: false, message: `catalog import unknown column ${key}` };
      if (value == null) record[key] = '';
      else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        record[key] = String(value);
      } else if (Array.isArray(value) && key === 'cuisine_tags' && value.every((tag) => typeof tag === 'string')) {
        record[key] = value.join('|');
      } else {
        return { ok: false, message: `catalog import JSON row ${index + 1} field ${key} is not a scalar` };
      }
    }
    records.push({ line: index + 1, record });
  }
  return { ok: true, records };
}

export function parseCatalogImportDocument(
  text: string,
  format: 'csv' | 'json',
): { ok: true; document: ParsedDocument } | { ok: false; message: string } {
  if (Buffer.byteLength(text, 'utf8') > 16 * 1024 * 1024) {
    return { ok: false, message: 'catalog import file is too large' };
  }
  let records: { line: number; record: Record<string, string> }[];
  if (format === 'csv') {
    const parsed = recordsFromCsv(text);
    if (!parsed.ok) return parsed;
    records = parsed.records;
  } else {
    let raw: unknown;
    try {
      raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
    } catch {
      return { ok: false, message: 'catalog import JSON rejected' };
    }
    const parsed = jsonLineRecords(raw);
    if (!parsed.ok) return parsed;
    records = parsed.records;
  }
  const errors: CatalogMessage[] = [];
  const rows: CatalogImportRow[] = [];
  for (const entry of records) {
    const row = rowFromRecord(entry.record, entry.line, errors);
    if (row) rows.push(row);
  }
  return { ok: true, document: { rows, errors } };
}

function existingSlug(
  row: CatalogImportRow,
  snapshot: CatalogDbSnapshot,
  marketId: string | null,
): string | null {
  if (row.google_place_id) {
    const hits = snapshot.restaurants.filter(
      (restaurant) => restaurant.google_place_id === row.google_place_id && restaurant.slug,
    );
    if (hits.length === 1) return hits[0]?.slug ?? null;
  }
  if (!marketId) return null;
  const hits = snapshot.restaurants.filter(
    (restaurant) =>
      restaurant.market_id === marketId &&
      restaurant.slug &&
      normalizeMatchText(restaurant.name) === normalizeMatchText(row.name) &&
      normalizeMatchText(restaurant.address ?? '') === normalizeMatchText(row.address),
  );
  return hits.length === 1 ? (hits[0]?.slug ?? null) : null;
}

function allocateSlug(name: string, taken: Set<string>): string {
  const base = slugify(name) || 'restaurant';
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('Unable to allocate a unique slug for this restaurant name.');
}

function duplicateMessages(rows: CatalogImportRow[]): CatalogMessage[] {
  const errors: CatalogMessage[] = [];
  const groups = new Map<string, CatalogImportRow[]>();
  const add = (key: string, row: CatalogImportRow) => {
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  };
  for (const row of rows) {
    if (row.google_place_id) add(`place:${row.google_place_id}`, row);
    if (row.slug) add(`slug:${row.market_slug}:${row.slug}`, row);
    add(`naz:${row.market_slug}:${nameAddressZipKey(row.name, row.address, row.zip)}`, row);
  }
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const lines = group.map((row) => row.line);
    const market = group[0]?.market_slug ?? null;
    const message = key.startsWith('place:')
      ? `duplicate google_place_id ${key.slice(6)} on ${linesPhrase(lines)}`
      : key.startsWith('slug:')
        ? `duplicate slug ${group[0]?.slug ?? ''} on ${linesPhrase(lines)}`
        : `duplicate name, address, and zip on ${linesPhrase(lines)}`;
    errors.push({
      line: lines[0] ?? null,
      lines,
      market_slug: market,
      message,
    });
  }
  return errors;
}

type MarketSpec = {
  slug: string;
  name: string | null;
  state: string | null;
  timezone: string | null;
  existing: CatalogDbMarket | null;
};

function marketSpecs(
  rows: CatalogImportRow[],
  snapshot: CatalogDbSnapshot,
  errors: CatalogMessage[],
): Map<string, MarketSpec> {
  const existing = new Map(snapshot.markets.map((market) => [market.slug, market]));
  const specs = new Map<string, MarketSpec>();
  for (const row of rows) {
    const spec = specs.get(row.market_slug) ?? {
      slug: row.market_slug,
      name: null,
      state: null,
      timezone: null,
      existing: existing.get(row.market_slug) ?? null,
    };
    for (const field of ['market_name', 'market_state', 'market_timezone'] as const) {
      const value = row[field];
      const key = field === 'market_name' ? 'name' : field === 'market_state' ? 'state' : 'timezone';
      if (!value) continue;
      if (spec[key] && spec[key] !== value) {
        errors.push({
          line: row.line,
          market_slug: row.market_slug,
          message: `${field} conflicts with another row`,
        });
      } else {
        spec[key] = value;
      }
    }
    specs.set(row.market_slug, spec);
  }
  for (const spec of specs.values()) {
    if (spec.existing) {
      if (spec.timezone && spec.existing.timezone && spec.timezone !== spec.existing.timezone) {
        errors.push({
          line: null,
          market_slug: spec.slug,
          message: 'market_timezone does not match the existing market',
        });
      }
      continue;
    }
    if (!spec.name || !spec.state || !spec.timezone) {
      errors.push({
        line: null,
        market_slug: spec.slug,
        message: 'new market needs market_name, market_state, and market_timezone',
      });
    } else if (!isIanaTimeZone(spec.timezone)) {
      errors.push({
        line: null,
        market_slug: spec.slug,
        message: 'market_timezone is not an IANA time zone',
      });
    }
  }
  return specs;
}

function dbZip(restaurant: CatalogDbRestaurant): string {
  return zipFromAddress(restaurant.address) ?? '';
}

function findMatch(
  row: CatalogImportRow,
  snapshot: CatalogDbSnapshot,
  marketId: string | null,
  errors: CatalogMessage[],
): CatalogDbRestaurant | null | 'ambiguous' {
  if (row.google_place_id) {
    const hits = snapshot.restaurants.filter((restaurant) => restaurant.google_place_id === row.google_place_id);
    if (hits.length > 1) {
      const bySlug = row.slug ? hits.filter((restaurant) => restaurant.slug === row.slug) : [];
      if (bySlug.length === 1 && bySlug[0]) return bySlug[0];
      errors.push({
        line: row.line,
        market_slug: row.market_slug,
        message: `google_place_id ${row.google_place_id} matches multiple database rows`,
      });
      return 'ambiguous';
    }
    if (hits.length === 1 && hits[0]) {
      if (marketId && hits[0].market_id && hits[0].market_id !== marketId) {
        errors.push({
          line: row.line,
          market_slug: row.market_slug,
          message: `google_place_id ${row.google_place_id} already belongs to another market`,
        });
        return 'ambiguous';
      }
      return hits[0];
    }
  }
  if (marketId && row.slug) {
    const hits = snapshot.restaurants.filter(
      (restaurant) => restaurant.market_id === marketId && restaurant.slug === row.slug,
    );
    if (hits.length > 1) {
      errors.push({
        line: row.line,
        market_slug: row.market_slug,
        message: `slug ${row.slug} matches multiple database rows`,
      });
      return 'ambiguous';
    }
    if (hits.length === 1 && hits[0]) return hits[0];
  }
  if (!marketId) return null;
  const key = nameAddressZipKey(row.name, row.address, row.zip);
  const hits = snapshot.restaurants.filter(
    (restaurant) =>
      restaurant.market_id === marketId &&
      nameAddressZipKey(restaurant.name, restaurant.address ?? '', dbZip(restaurant)) === key,
  );
  if (hits.length > 1) {
    errors.push({
      line: row.line,
      market_slug: row.market_slug,
      message: 'name, address, and zip match multiple database rows',
    });
    return 'ambiguous';
  }
  return hits[0] ?? null;
}

function possibleDuplicates(snapshot: CatalogDbSnapshot, marketSlugs: ReadonlySet<string>): CatalogPossibleDuplicate[] {
  const markets = new Map(snapshot.markets.map((market) => [market.id, market]));
  const found = new Map<string, CatalogPossibleDuplicate>();
  const add = (marketSlug: string, left: string, right: string, reason: CatalogPossibleDuplicate['reason']) => {
    const pair = [left, right].sort();
    const key = `${marketSlug}:${pair[0]}:${pair[1]}:${reason}`;
    if (!pair[0] || !pair[1] || pair[0] === pair[1]) return;
    found.set(key, { market_slug: marketSlug, left_slug: pair[0], right_slug: pair[1], reason });
  };
  const byMarket = new Map<string, CatalogDbRestaurant[]>();
  for (const restaurant of snapshot.restaurants) {
    const market = restaurant.market_id ? markets.get(restaurant.market_id) : undefined;
    if (!market || !marketSlugs.has(market.slug) || !restaurant.slug) continue;
    const list = byMarket.get(market.slug) ?? [];
    list.push(restaurant);
    byMarket.set(market.slug, list);
  }
  for (const [marketSlug, restaurants] of byMarket) {
    const byPlace = new Map<string, string[]>();
    const byName = new Map<string, string[]>();
    const slugs = new Set<string>();
    for (const restaurant of restaurants) {
      if (!restaurant.slug) continue;
      slugs.add(restaurant.slug);
      if (restaurant.google_place_id) {
        const list = byPlace.get(restaurant.google_place_id) ?? [];
        list.push(restaurant.slug);
        byPlace.set(restaurant.google_place_id, list);
      }
      const key = nameAddressKey(restaurant.name, restaurant.address ?? '');
      const named = byName.get(key) ?? [];
      named.push(restaurant.slug);
      byName.set(key, named);
    }
    for (const slugsInGroup of byPlace.values()) {
      for (let left = 0; left < slugsInGroup.length; left += 1) {
        for (let right = left + 1; right < slugsInGroup.length; right += 1) {
          const a = slugsInGroup[left];
          const b = slugsInGroup[right];
          if (a && b) add(marketSlug, a, b, 'google_place_id');
        }
      }
    }
    for (const slugsInGroup of byName.values()) {
      for (let left = 0; left < slugsInGroup.length; left += 1) {
        for (let right = left + 1; right < slugsInGroup.length; right += 1) {
          const a = slugsInGroup[left];
          const b = slugsInGroup[right];
          if (a && b) add(marketSlug, a, b, 'name_address');
        }
      }
    }
    for (const slug of slugs) {
      if (slugs.has(`${slug}-2`)) add(marketSlug, slug, `${slug}-2`, 'slug_suffix');
    }
  }
  return [...found.values()].sort((a, b) =>
    `${a.market_slug}:${a.left_slug}:${a.right_slug}:${a.reason}`.localeCompare(
      `${b.market_slug}:${b.left_slug}:${b.right_slug}:${b.reason}`,
    ),
  );
}

function pauseMethod(restaurant: CatalogDbRestaurant): 'retire_restaurant' | 'direct_pause' {
  if (restaurant.challenge_item_count > 0 || restaurant.offer_version_count > 0) return 'retire_restaurant';
  return 'direct_pause';
}

function selectionProblem(terms: OfferVersionTerms, now: Date): string | null {
  const problem = offerVersionTermsProblem(terms);
  if (problem) return problem;
  const deadline = new Date(now.getTime() + ASSIGNMENT_WINDOW_MS);
  if (
    !terms.valid_from ||
    !terms.valid_until ||
    !offerVersionCoversDeadline(
      {
        valid_from: terms.valid_from,
        valid_until: terms.valid_until,
        withdrawn_from_selection_at: null,
      },
      now,
      deadline,
    )
  ) {
    return 'not_selectable';
  }
  return null;
}

function restaurantWrite(
  row: CatalogImportRow,
  slug: string,
  lat: number,
  lon: number,
  status: 'active' | 'paused',
): CatalogRestaurantWrite {
  return {
    name: row.name,
    slug,
    address: row.address,
    lat,
    lon,
    google_place_id: row.google_place_id,
    cuisine_tags: row.cuisine_tags.length > 0 ? row.cuisine_tags : null,
    is_vegan: row.is_vegan,
    is_dairy_free: row.is_dairy_free,
    is_halal: row.is_halal,
    price_range: row.price_range,
    neighborhood: row.neighborhood,
    status,
  };
}

function diffRestaurant(
  current: CatalogDbRestaurant,
  desired: CatalogRestaurantWrite,
): CatalogRestaurantPatch | null {
  const patch: CatalogRestaurantPatch = {};
  if (current.name !== desired.name) patch.name = desired.name;
  if ((current.slug ?? null) !== desired.slug) patch.slug = desired.slug;
  if ((current.address ?? null) !== desired.address) patch.address = desired.address;
  if ((current.google_place_id ?? null) !== (desired.google_place_id ?? null)) {
    patch.google_place_id = desired.google_place_id;
  }
  if (!sameTags(current.cuisine_tags, desired.cuisine_tags ?? [])) patch.cuisine_tags = desired.cuisine_tags;
  if (current.is_vegan !== desired.is_vegan) patch.is_vegan = desired.is_vegan;
  if (current.is_dairy_free !== desired.is_dairy_free) patch.is_dairy_free = desired.is_dairy_free;
  if (current.is_halal !== desired.is_halal) patch.is_halal = desired.is_halal;
  if ((current.price_range ?? null) !== desired.price_range) patch.price_range = desired.price_range;
  if ((current.neighborhood ?? null) !== desired.neighborhood) patch.neighborhood = desired.neighborhood;
  if ((current.status ?? 'active') !== desired.status) patch.status = desired.status;
  if (!sameCoord(current.lat, desired.lat) || !sameCoord(current.lon, desired.lon)) {
    patch.lat = desired.lat;
    patch.lon = desired.lon;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

type ResolvedRow = {
  row: CatalogImportRow;
  slug: string;
  lat: number;
  lon: number;
  provenance: CoordinateProvenance;
  match: CatalogDbRestaurant | null;
};

function geocodeRequestFor(row: CatalogImportRow): GeocodeRequest | null {
  if (row.lat != null && row.lon != null) return null;
  if (row.google_place_id) return { kind: 'place_id', placeId: row.google_place_id };
  return { kind: 'address', query: `${row.address}, ${row.city}, ${row.zip}` };
}

export function geocodeCacheKey(request: GeocodeRequest): string {
  if (request.kind === 'place_id') return `place:${request.placeId}`;
  return `address:${normalizeMatchText(request.query)}`;
}

export async function geocodeWithCache(
  request: GeocodeRequest,
  cache: GeocodeCache,
  fetchPlace: Geocoder,
): Promise<{ result: GeocodeResult; cache: GeocodeCache }> {
  const key = geocodeCacheKey(request);
  const hit = cache.entries[key];
  if (hit) return { result: { lat: hit.lat, lon: hit.lon }, cache };
  const result = await fetchPlace(request);
  if ('error' in result) return { result, cache };
  return {
    result,
    cache: {
      v: 1,
      entries: { ...cache.entries, [key]: { lat: result.lat, lon: result.lon } },
    },
  };
}

export async function fetchGooglePlaceCoordinates(
  request: GeocodeRequest,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeResult> {
  const params = new URLSearchParams({ key: apiKey, fields: 'geometry' });
  let url: string;
  if (request.kind === 'place_id') {
    params.set('place_id', request.placeId);
    url = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;
  } else {
    params.set('input', request.query);
    params.set('inputtype', 'textquery');
    url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params.toString()}`;
  }
  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return { error: 'places request failed' };
    const body = (await response.json()) as {
      status?: string;
      result?: { geometry?: { location?: { lat?: number; lng?: number } } };
      candidates?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
    };
    if (body.status !== 'OK') return { error: 'places lookup failed' };
    const location =
      request.kind === 'place_id'
        ? body.result?.geometry?.location
        : body.candidates?.length === 1
          ? body.candidates[0]?.geometry?.location
          : undefined;
    if (request.kind === 'address' && (body.candidates?.length ?? 0) !== 1) {
      return { error: 'places address lookup was not unique' };
    }
    const lat = location?.lat;
    const lon = location?.lng;
    if (typeof lat !== 'number' || typeof lon !== 'number' || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return { error: 'places lookup returned no coordinates' };
    }
    return { lat, lon };
  } catch {
    return { error: 'places request failed' };
  }
}

function kmBetween(left: { lat: number; lon: number }, right: { lat: number; lon: number }): number {
  return haversineMiles(left, right) * KM_PER_MILE;
}

export function catalogSnapshotHash(snapshot: CatalogDbSnapshot, marketSlugs: readonly string[]): string {
  const slugSet = new Set(marketSlugs);
  const markets = snapshot.markets
    .filter((market) => slugSet.has(market.slug))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((market) => ({
      id: market.id,
      slug: market.slug,
      name: market.name,
      state: market.state,
      timezone: market.timezone,
      status: market.status,
    }));
  const marketIds = new Set(markets.map((market) => market.id));
  const restaurants = snapshot.restaurants
    .filter((restaurant) => restaurant.market_id != null && marketIds.has(restaurant.market_id))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((restaurant) => ({
      id: restaurant.id,
      market_id: restaurant.market_id,
      name: restaurant.name,
      slug: restaurant.slug,
      address: restaurant.address,
      lat: restaurant.lat,
      lon: restaurant.lon,
      google_place_id: restaurant.google_place_id,
      cuisine_tags: [...(restaurant.cuisine_tags ?? [])].sort(),
      is_vegan: restaurant.is_vegan,
      is_dairy_free: restaurant.is_dairy_free,
      is_halal: restaurant.is_halal,
      price_range: restaurant.price_range,
      neighborhood: restaurant.neighborhood,
      status: restaurant.status,
      current_offer_version_id: restaurant.current_offer_version_id,
      challenge_item_count: restaurant.challenge_item_count,
      offer_version_count: restaurant.offer_version_count,
    }));
  const testOffers = snapshot.test_offers
    .filter((offer) => slugSet.has(offer.market_slug))
    .map((offer) => ({
      version_id: offer.version_id,
      restaurant_id: offer.restaurant_id,
      market_slug: offer.market_slug,
    }))
    .sort((left, right) => left.version_id.localeCompare(right.version_id));
  return createHash('sha256').update(JSON.stringify({ markets, restaurants, test_offers: testOffers })).digest('hex');
}

function finishPlan(args: {
  accepted: boolean;
  mode: 'import' | 'withdraw';
  markets: string[];
  snapshot: CatalogDbSnapshot;
  counts: CatalogPlanCounts;
  byMarket: Record<string, CatalogPlanCounts>;
  warnings: CatalogMessage[];
  errors: CatalogMessage[];
  skipped: CatalogMessage[];
  duplicates: CatalogPossibleDuplicate[];
  refusedRealOffers?: CatalogRefusedRealOffer[];
  actions: CatalogPlanAction[];
  sourceLabel: string;
  now: Date;
}): CatalogPlan {
  for (const warning of args.warnings) bump(args.counts, args.byMarket, warning.market_slug, 'warnings');
  for (const error of args.errors) bump(args.counts, args.byMarket, error.market_slug, 'errors');
  return {
    schema: CATALOG_IMPORT_PLAN_SCHEMA,
    created_at: args.now.toISOString(),
    source_label: args.sourceLabel,
    accepted: args.accepted && args.errors.length === 0,
    mode: args.mode,
    markets: args.markets,
    snapshot_hash: catalogSnapshotHash(args.snapshot, args.markets),
    counts: args.counts,
    by_market: args.byMarket,
    warnings: args.warnings,
    errors: args.errors,
    skipped: args.skipped,
    possible_duplicates: args.duplicates,
    refused_real_offers: args.refusedRealOffers ?? [],
    actions: args.actions,
  };
}

export async function buildCatalogPlan(args: {
  document: ParsedDocument;
  snapshot: CatalogDbSnapshot;
  options: CatalogPlanOptions;
  geocoder: Geocoder | null;
}): Promise<CatalogPlan> {
  const counts = emptyCounts();
  const byMarket: Record<string, CatalogPlanCounts> = {};
  const warnings: CatalogMessage[] = [];
  const skipped: CatalogMessage[] = [];
  if (args.options.withdrawTestOffers) {
    if (args.document.rows.length > 0 || args.options.testOffers) {
      return finishPlan({
        accepted: false,
        mode: 'withdraw',
        markets: [...args.options.markets],
        snapshot: args.snapshot,
        counts,
        byMarket,
        warnings,
        errors: [
          {
            line: null,
            market_slug: null,
            message: '--withdraw-test-offers cannot be combined with a file or --test-offers',
          },
        ],
        skipped,
        duplicates: [],
        actions: [],
        sourceLabel: args.options.sourceLabel,
        now: args.options.now,
      });
    }
    const markets = [...new Set(args.options.markets)].sort();
    const actions: Array<Extract<CatalogPlanAction, { kind: 'withdraw_test_offer' }>> = args.snapshot.test_offers
      .filter((offer) => markets.includes(offer.market_slug))
      .sort((left, right) => left.version_id.localeCompare(right.version_id))
      .map((offer) => ({
        kind: 'withdraw_test_offer' as const,
        market_slug: offer.market_slug,
        restaurant_id: offer.restaurant_id,
        version_id: offer.version_id,
      }));
    for (const action of actions) bump(counts, byMarket, action.market_slug, 'withdraw');
    return finishPlan({
      accepted: markets.length > 0,
      mode: 'withdraw',
      markets,
      snapshot: args.snapshot,
      counts,
      byMarket,
      warnings,
      errors:
        markets.length > 0
          ? []
          : [{ line: null, market_slug: null, message: '--withdraw-test-offers needs --market' }],
      skipped,
      duplicates: [],
      actions: markets.length > 0 ? actions : [],
      sourceLabel: args.options.sourceLabel,
      now: args.options.now,
    });
  }

  let rows = [...args.document.rows];
  let errors = [...args.document.errors];
  const dropErrorRows = () => {
    if (!args.options.skipInvalid || errors.length === 0) return;
    const badLines = new Set(
      errors.flatMap((error) => error.lines ?? (error.line == null ? [] : [error.line])),
    );
    const badMarkets = new Set(
      errors.flatMap((error) =>
        error.line == null && error.lines == null && error.market_slug ? [error.market_slug] : [],
      ),
    );
    const seen = new Set<number>();
    for (const row of rows) {
      if (!badLines.has(row.line) && !badMarkets.has(row.market_slug)) continue;
      skipped.push({ line: row.line, market_slug: row.market_slug, message: 'skipped invalid row' });
      bump(counts, byMarket, row.market_slug, 'skipped');
      seen.add(row.line);
    }
    for (const error of errors) {
      const lines = error.lines ?? (error.line == null ? [] : [error.line]);
      for (const line of lines) {
        if (seen.has(line)) continue;
        skipped.push({ line, market_slug: error.market_slug, message: error.message });
        bump(counts, byMarket, error.market_slug, 'skipped');
        seen.add(line);
      }
    }
    rows = rows.filter((row) => !badLines.has(row.line) && !badMarkets.has(row.market_slug));
    errors = [];
  };

  if (errors.length > 0 && !args.options.skipInvalid) {
    const markets = [...new Set(rows.map((row) => row.market_slug))].sort();
    return finishPlan({
      accepted: false,
      mode: 'import',
      markets,
      snapshot: args.snapshot,
      counts,
      byMarket,
      warnings,
      errors,
      skipped,
      duplicates: [],
      actions: [],
      sourceLabel: args.options.sourceLabel,
      now: args.options.now,
    });
  }
  dropErrorRows();

  const taken = new Set(
    args.snapshot.restaurants.map((restaurant) => restaurant.slug).filter((slug): slug is string => Boolean(slug)),
  );
  for (const row of rows) {
    if (row.slug) taken.add(row.slug);
  }
  for (const row of rows) {
    if (row.slug) continue;
    const marketId = args.snapshot.markets.find((market) => market.slug === row.market_slug)?.id ?? null;
    const existing = existingSlug(row, args.snapshot, marketId);
    row.slug = existing ?? allocateSlug(row.name, taken);
    taken.add(row.slug);
  }
  errors.push(...duplicateMessages(rows));
  const specs = marketSpecs(rows, args.snapshot, errors);
  if (errors.length > 0 && !args.options.skipInvalid) {
    return finishPlan({
      accepted: false,
      mode: 'import',
      markets: [...specs.keys()].sort(),
      snapshot: args.snapshot,
      counts,
      byMarket,
      warnings,
      errors,
      skipped,
      duplicates: [],
      actions: [],
      sourceLabel: args.options.sourceLabel,
      now: args.options.now,
    });
  }
  dropErrorRows();

  const resolved: ResolvedRow[] = [];
  const memo = new Map<string, GeocodeResult>();
  for (const row of rows) {
    const market = specs.get(row.market_slug);
    const marketId = market?.existing?.id ?? null;
    const match = findMatch(row, args.snapshot, marketId, errors);
    if (match === 'ambiguous') continue;
    const request = geocodeRequestFor(row);
    const keepExisting =
      request != null &&
      match != null &&
      match.lat != null &&
      match.lon != null &&
      !args.options.refreshCoordinates;
    if (row.lat != null && row.lon != null) {
      resolved.push({
        row,
        slug: row.slug ?? '',
        lat: row.lat,
        lon: row.lon,
        provenance: 'provided',
        match,
      });
      continue;
    }
    if (keepExisting && match && match.lat != null && match.lon != null) {
      resolved.push({
        row,
        slug: row.slug ?? '',
        lat: match.lat,
        lon: match.lon,
        provenance: 'preserved',
        match,
      });
      continue;
    }
    if (!request) continue;
    if (args.options.outboundDisabled) {
      errors.push({
        line: row.line,
        market_slug: row.market_slug,
        message: 'coordinates are missing and Google Places outbound is disabled',
      });
      continue;
    }
    if (!args.options.apiKeyPresent || !args.geocoder) {
      errors.push({
        line: row.line,
        market_slug: row.market_slug,
        message: 'coordinates are missing and GOOGLE_PLACES_API_KEY is not set',
      });
      continue;
    }
    const key = geocodeCacheKey(request);
    let result = memo.get(key);
    if (!result) {
      result = await args.geocoder(request);
      memo.set(key, result);
    }
    if ('error' in result) {
      errors.push({ line: row.line, market_slug: row.market_slug, message: result.error });
      continue;
    }
    resolved.push({
      row,
      slug: row.slug ?? '',
      lat: result.lat,
      lon: result.lon,
      provenance: request.kind === 'place_id' ? 'places:place_id' : 'places:address',
      match,
    });
  }

  if (errors.length > 0 && !args.options.skipInvalid) {
    return finishPlan({
      accepted: false,
      mode: 'import',
      markets: [...new Set([...args.options.markets, ...rows.map((row) => row.market_slug)])].sort(),
      snapshot: args.snapshot,
      counts,
      byMarket,
      warnings,
      errors,
      skipped,
      duplicates: [],
      actions: [],
      sourceLabel: args.options.sourceLabel,
      now: args.options.now,
    });
  }
  if (args.options.skipInvalid && errors.length > 0) {
    const bad = new Set(errors.flatMap((error) => (error.line == null ? [] : [error.line])));
    for (const row of rows) {
      if (!bad.has(row.line)) continue;
      if (resolved.some((entry) => entry.row.line === row.line)) continue;
      skipped.push({ line: row.line, market_slug: row.market_slug, message: 'skipped invalid row' });
      bump(counts, byMarket, row.market_slug, 'skipped');
    }
    errors = [];
  }

  const actions: CatalogPlanAction[] = [];
  const marketSlugs = new Set<string>([
    ...args.options.markets,
    ...resolved.map((entry) => entry.row.market_slug),
  ]);
  for (const slug of [...marketSlugs].sort()) {
    const spec = specs.get(slug);
    const existing = spec?.existing ?? args.snapshot.markets.find((market) => market.slug === slug) ?? null;
    if (!existing && spec?.name && spec.state && spec.timezone) {
      actions.push({
        kind: 'create_market',
        slug,
        name: spec.name,
        state: spec.state,
        timezone: spec.timezone,
        country: 'US',
        currency: 'USD',
        status: 'active',
      });
      bump(counts, byMarket, slug, 'market_create');
    } else if (!existing && marketSlugs.has(slug) && args.options.markets.includes(slug) && !spec) {
      errors.push({ line: null, market_slug: slug, message: `market ${slug} does not exist` });
    }
  }

  const dropSlugs = new Set(args.options.resolveDuplicates.map((pair) => pair.drop));
  const activeEnds: { market_slug: string; slug: string; id: string | null; hasVersion: boolean; publishFromRow: boolean }[] =
    [];
  const matchedIds = new Set<string>();

  for (const entry of resolved) {
    const forcedPause = dropSlugs.has(entry.slug);
    const status = forcedPause ? 'paused' : entry.row.status;
    const desired = restaurantWrite(entry.row, entry.slug, entry.lat, entry.lon, status);
    if (!entry.match) {
      const slugOwner = args.snapshot.restaurants.find((restaurant) => restaurant.slug === entry.slug);
      if (slugOwner && slugOwner.market_id !== (specs.get(entry.row.market_slug)?.existing?.id ?? null)) {
        errors.push({
          line: entry.row.line,
          market_slug: entry.row.market_slug,
          message: `slug ${entry.slug} is already used`,
        });
        continue;
      }
      actions.push({
        kind: 'create_restaurant',
        market_slug: entry.row.market_slug,
        restaurant: desired,
        coordinate_provenance: entry.provenance,
      });
      bump(counts, byMarket, entry.row.market_slug, 'create');
      activeEnds.push({
        market_slug: entry.row.market_slug,
        slug: entry.slug,
        id: null,
        hasVersion: false,
        publishFromRow: entry.row.offer != null,
      });
      continue;
    }
    matchedIds.add(entry.match.id);
    const patch = diffRestaurant(entry.match, desired);
    if (patch && !(forcedPause && Object.keys(patch).length === 1 && patch.status === 'paused')) {
      if (forcedPause && patch.status === 'paused' && (entry.match.status ?? 'active') !== 'paused') {
        delete patch.status;
      }
      if (Object.keys(patch).length > 0) {
        actions.push({
          kind: 'update_restaurant',
          restaurant_id: entry.match.id,
          market_slug: entry.row.market_slug,
          slug: entry.slug,
          patch,
          coordinate_provenance: entry.provenance,
        });
        bump(counts, byMarket, entry.row.market_slug, 'update');
      } else {
        bump(counts, byMarket, entry.row.market_slug, 'unchanged');
      }
    } else {
      bump(counts, byMarket, entry.row.market_slug, 'unchanged');
    }
    activeEnds.push({
      market_slug: entry.row.market_slug,
      slug: entry.slug,
      id: entry.match.id,
      hasVersion: Boolean(entry.match.current_offer_version_id),
      publishFromRow: entry.row.offer != null && !entry.match.current_offer_version_id,
    });
  }

  const duplicates = possibleDuplicates(args.snapshot, marketSlugs);
  const duplicatePairs = new Set(duplicates.map((pair) => `${pair.left_slug}:${pair.right_slug}`));
  for (const pair of args.options.resolveDuplicates) {
    if (pair.keep === pair.drop) {
      errors.push({ line: null, market_slug: null, message: 'resolve-duplicate keep and drop are the same slug' });
      continue;
    }
    const known = duplicatePairs.has(`${pair.keep}:${pair.drop}`) || duplicatePairs.has(`${pair.drop}:${pair.keep}`);
    if (!known) {
      errors.push({
        line: null,
        market_slug: null,
        message: `resolve-duplicate ${pair.keep}/${pair.drop} is not a reported duplicate`,
      });
      continue;
    }
    const drop = args.snapshot.restaurants.find((restaurant) => restaurant.slug === pair.drop);
    const keep = args.snapshot.restaurants.find((restaurant) => restaurant.slug === pair.keep);
    if (!drop || !keep || !drop.slug || drop.market_id == null || drop.market_id !== keep.market_id) {
      errors.push({
        line: null,
        market_slug: null,
        message: `resolve-duplicate ${pair.keep}/${pair.drop} must be two rows in one market`,
      });
      continue;
    }
    const market = args.snapshot.markets.find((entry) => entry.id === drop.market_id);
    if (!market) continue;
    if ((drop.status ?? 'active') !== 'paused') {
      actions.push({
        kind: 'pause_duplicate',
        restaurant_id: drop.id,
        market_slug: market.slug,
        slug: drop.slug,
        keep_slug: pair.keep,
        method: pauseMethod(drop),
      });
      bump(counts, byMarket, market.slug, 'pause');
    }
    const end = activeEnds.find((entry) => entry.id === drop.id);
    if (end) end.hasVersion = true;
  }

  const timezoneFor = (marketSlug: string): string | null => {
    const spec = specs.get(marketSlug);
    return spec?.timezone ?? spec?.existing?.timezone ?? args.snapshot.markets.find((market) => market.slug === marketSlug)?.timezone ?? null;
  };

  const publishRow = (entry: ResolvedRow) => {
    if (!entry.row.offer || entry.match?.current_offer_version_id) return;
    const timezone = timezoneFor(entry.row.market_slug);
    if (!timezone) {
      errors.push({
        line: entry.row.line,
        market_slug: entry.row.market_slug,
        message: 'offer terms need a market timezone',
      });
      return;
    }
    const offer = entry.row.offer;
    const terms = buildTestOfferTerms({
      now: args.options.now,
      timezone,
      capacityMaxRedemptions: offer.capacity_max_redemptions ?? args.options.testOfferCapacity,
      baseDiscountCents: offer.base_discount_cents ?? TEST_OFFER_BASE_CENTS,
      validFrom: offer.valid_from,
      validUntil: offer.valid_until,
    });
    const problem = selectionProblem(terms, args.options.now);
    if (problem) {
      errors.push({
        line: entry.row.line,
        market_slug: entry.row.market_slug,
        message: `offer terms rejected: ${problem}`,
      });
      return;
    }
    const paused = dropSlugs.has(entry.slug) || entry.row.status === 'paused';
    if (paused) return;
    if (!offer.is_test_offer && !args.options.publishRealOffers) {
      refusedRealOffers.push({
        line: entry.row.line,
        market_slug: entry.row.market_slug,
        slug: entry.slug,
      });
      warnings.push({
        line: entry.row.line,
        market_slug: entry.row.market_slug,
        message: `refused real offer for ${entry.slug}; pass --publish-real-offers to publish a non-test offer`,
      });
      return;
    }
    actions.push({
      kind: 'publish_offer',
      market_slug: entry.row.market_slug,
      restaurant_slug: entry.slug,
      restaurant_id: entry.match?.id ?? null,
      terms,
      exclusions: offerExclusions(),
      is_test: offer.is_test_offer,
      source: offer.is_test_offer ? TEST_OFFER_SOURCE : 'catalog-import',
    });
    bump(counts, byMarket, entry.row.market_slug, 'publish');
  };
  const refusedRealOffers: CatalogRefusedRealOffer[] = [];
  for (const entry of resolved) publishRow(entry);

  if (args.options.testOffers) {
    const published = new Set(
      actions.filter((action) => action.kind === 'publish_offer').map((action) => action.restaurant_slug),
    );
    const paused = new Set(
      actions.filter((action) => action.kind === 'pause_duplicate').map((action) => action.slug),
    );
    for (const end of activeEnds) {
      if (published.has(end.slug) || paused.has(end.slug) || end.hasVersion || end.publishFromRow) continue;
      const created = actions.find(
        (action) => action.kind === 'create_restaurant' && action.restaurant.slug === end.slug,
      );
      if (created && created.kind === 'create_restaurant' && created.restaurant.status !== 'active') continue;
      const matched = end.id ? args.snapshot.restaurants.find((restaurant) => restaurant.id === end.id) : null;
      if (matched && (matched.status ?? 'active') !== 'active' && !resolved.some((entry) => entry.slug === end.slug && entry.row.status === 'active')) {
        continue;
      }
      if (resolved.some((entry) => entry.slug === end.slug && (entry.row.status === 'paused' || dropSlugs.has(entry.slug)))) {
        continue;
      }
      const timezone = timezoneFor(end.market_slug);
      if (!timezone) continue;
      const terms = buildTestOfferTerms({
        now: args.options.now,
        timezone,
        capacityMaxRedemptions: args.options.testOfferCapacity,
      });
      const problem = selectionProblem(terms, args.options.now);
      if (problem) {
        errors.push({
          line: null,
          market_slug: end.market_slug,
          message: `test offer terms rejected: ${problem}`,
        });
        continue;
      }
      actions.push({
        kind: 'publish_offer',
        market_slug: end.market_slug,
        restaurant_slug: end.slug,
        restaurant_id: end.id,
        terms,
        exclusions: offerExclusions(),
        is_test: true,
        source: TEST_OFFER_SOURCE,
      });
      bump(counts, byMarket, end.market_slug, 'publish');
      published.add(end.slug);
    }
    if (args.options.testOffersAllInMarket) for (const restaurant of args.snapshot.restaurants) {
      if (!restaurant.slug || matchedIds.has(restaurant.id) || restaurant.current_offer_version_id) continue;
      if ((restaurant.status ?? 'active') !== 'active') continue;
      if (paused.has(restaurant.slug) || dropSlugs.has(restaurant.slug)) continue;
      const market = args.snapshot.markets.find((entry) => entry.id === restaurant.market_id);
      if (!market || !marketSlugs.has(market.slug)) continue;
      if (published.has(restaurant.slug)) continue;
      const timezone = market.timezone;
      if (!timezone) continue;
      const terms = buildTestOfferTerms({
        now: args.options.now,
        timezone,
        capacityMaxRedemptions: args.options.testOfferCapacity,
      });
      actions.push({
        kind: 'publish_offer',
        market_slug: market.slug,
        restaurant_slug: restaurant.slug,
        restaurant_id: restaurant.id,
        terms,
        exclusions: offerExclusions(),
        is_test: true,
        source: TEST_OFFER_SOURCE,
      });
      bump(counts, byMarket, market.slug, 'publish');
    }
  }

  const pointsByMarket = new Map<string, { key: string; lat: number; lon: number }[]>();
  for (const entry of resolved) {
    const list = pointsByMarket.get(entry.row.market_slug) ?? [];
    list.push({ key: entry.slug, lat: entry.lat, lon: entry.lon });
    pointsByMarket.set(entry.row.market_slug, list);
  }
  for (const restaurant of args.snapshot.restaurants) {
    if (restaurant.lat == null || restaurant.lon == null || !restaurant.slug) continue;
    if (matchedIds.has(restaurant.id)) continue;
    const market = args.snapshot.markets.find((entry) => entry.id === restaurant.market_id);
    if (!market || !marketSlugs.has(market.slug)) continue;
    const list = pointsByMarket.get(market.slug) ?? [];
    list.push({ key: restaurant.slug, lat: restaurant.lat, lon: restaurant.lon });
    pointsByMarket.set(market.slug, list);
  }
  for (const entry of resolved) {
    const points = pointsByMarket.get(entry.row.market_slug) ?? [];
    const others = points.filter((point) => point.key !== entry.slug);
    if (others.length === 0) continue;
    const center = {
      lat: others.reduce((sum, point) => sum + point.lat, 0) / others.length,
      lon: others.reduce((sum, point) => sum + point.lon, 0) / others.length,
    };
    const distance = kmBetween(center, { lat: entry.lat, lon: entry.lon });
    if (distance > OUTSIDE_MARKET_KM) {
      warnings.push({
        line: entry.row.line,
        market_slug: entry.row.market_slug,
        message: `${entry.slug} is ${distance.toFixed(1)} km from the market centroid`,
      });
    }
  }

  const markets = [...marketSlugs].sort();
  return finishPlan({
    accepted: errors.length === 0,
    mode: 'import',
    markets,
    snapshot: args.snapshot,
    counts,
    byMarket,
    warnings,
    errors,
    skipped,
    duplicates,
    refusedRealOffers,
    actions: errors.length > 0 ? [] : actions,
    sourceLabel: args.options.sourceLabel,
    now: args.options.now,
  });
}

export function formatCatalogImportSummary(plan: CatalogPlan): string {
  const lines = [
    `catalog import: ${plan.accepted ? 'accepted' : 'rejected'} mode=${plan.mode}`,
    `markets: ${plan.markets.join(', ') || '(none)'}`,
  ];
  const markets = Object.keys(plan.by_market).sort();
  for (const market of markets) {
    const counts = plan.by_market[market];
    if (!counts) continue;
    lines.push(
      `${market} create=${counts.create} update=${counts.update} unchanged=${counts.unchanged} skipped=${counts.skipped} errors=${counts.errors} pause=${counts.pause} publish=${counts.publish} withdraw=${counts.withdraw} market_create=${counts.market_create} warnings=${counts.warnings}`,
    );
  }
  const counts = plan.counts;
  lines.push(
    `total create=${counts.create} update=${counts.update} unchanged=${counts.unchanged} skipped=${counts.skipped} errors=${counts.errors} pause=${counts.pause} publish=${counts.publish} withdraw=${counts.withdraw} market_create=${counts.market_create} warnings=${counts.warnings}`,
  );
  for (const duplicate of plan.possible_duplicates) {
    lines.push(
      `possible_duplicate market=${duplicate.market_slug} ${duplicate.left_slug} ${duplicate.right_slug} reason=${duplicate.reason}`,
    );
  }
  for (const error of plan.errors) {
    lines.push(`error line=${error.line ?? '-'} market=${error.market_slug ?? '-'} ${error.message}`);
  }
  for (const warning of plan.warnings) {
    lines.push(`warning line=${warning.line ?? '-'} market=${warning.market_slug ?? '-'} ${warning.message}`);
  }
  for (const refused of plan.refused_real_offers) {
    lines.push(
      `refused_real_offer line=${refused.line ?? '-'} market=${refused.market_slug} slug=${refused.slug}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function applyGuardProblem(args: {
  applyEnv: string | undefined;
  confirm: readonly string[];
  plan: CatalogPlan;
  currentHash: string;
}): string | null {
  if (args.applyEnv !== '1') return 'catalog apply requires WANDERBITE_CATALOG_APPLY=1';
  if (!args.plan.accepted || args.plan.errors.length > 0) return 'catalog apply refused: plan has errors';
  if (!sameSet(args.confirm, args.plan.markets)) {
    return 'catalog apply refused: --confirm does not match plan markets';
  }
  if (args.currentHash !== args.plan.snapshot_hash) {
    return 'catalog apply refused: database changed since plan';
  }
  return null;
}

export type CatalogExecutor = {
  loadSnapshot(): Promise<CatalogDbSnapshot>;
  assertAdmin(actorId: string): Promise<boolean>;
  insertMarket(market: {
    slug: string;
    name: string;
    state: string;
    timezone: string;
    country: 'US';
    currency: 'USD';
    status: 'active';
  }): Promise<{ id: string }>;
  insertOrg(org: { name: string; market_id: string }): Promise<{ id: string }>;
  insertRestaurant(row: CatalogRestaurantWrite & { market_id: string; org_id: string }): Promise<{ id: string }>;
  updateRestaurant(id: string, patch: CatalogRestaurantPatch): Promise<void>;
  upsertDraft(draft: {
    restaurant_id: string;
    terms: OfferVersionTerms;
    exclusions: { exclude_tax: boolean; exclude_tip: boolean; categories: string[] };
  }): Promise<{ id: string }>;
  publishOfferVersion(
    draftId: string,
    actorId: string,
  ): Promise<{ published: boolean; versionId?: string; error?: string }>;
  insertTestMark(
    versionId: string,
    actorId: string,
    metadata: { is_test: true; source: string; restaurant_id: string },
  ): Promise<void>;
  retireRestaurant(
    restaurantId: string,
    actorId: string,
  ): Promise<{ ok: boolean; result?: string; error?: string }>;
  pauseRestaurant(
    restaurantId: string,
    actorId: string,
    metadata: { keep_slug: string; drop_slug: string },
  ): Promise<void>;
  withdrawOfferVersion(
    versionId: string,
    actorId: string,
  ): Promise<{ withdrawn: boolean; error?: string }>;
};

export async function applyCatalogPlan(args: {
  plan: CatalogPlan;
  confirm: readonly string[];
  actorId: string;
  applyEnv: string | undefined;
  exec: CatalogExecutor;
}): Promise<{ applied: number }> {
  const snapshot = await args.exec.loadSnapshot();
  const hash = catalogSnapshotHash(snapshot, args.plan.markets);
  const guard = applyGuardProblem({
    applyEnv: args.applyEnv,
    confirm: args.confirm,
    plan: args.plan,
    currentHash: hash,
  });
  if (guard) throw new Error(guard);
  if (!(await args.exec.assertAdmin(args.actorId))) throw new Error('catalog apply actor is not an admin');
  const marketIds = new Map(snapshot.markets.map((market) => [market.slug, market.id]));
  const restaurantIds = new Map(
    snapshot.restaurants.flatMap((restaurant) => (restaurant.slug ? [[restaurant.slug, restaurant.id] as const] : [])),
  );
  let applied = 0;
  for (const action of args.plan.actions) {
    if (action.kind === 'create_market') {
      const created = await args.exec.insertMarket(action);
      marketIds.set(action.slug, created.id);
      applied += 1;
      continue;
    }
    if (action.kind === 'create_restaurant') {
      const marketId = marketIds.get(action.market_slug);
      if (!marketId) throw new Error(`catalog apply missing market ${action.market_slug}`);
      const org = await args.exec.insertOrg({ name: action.restaurant.name, market_id: marketId });
      const created = await args.exec.insertRestaurant({
        ...action.restaurant,
        market_id: marketId,
        org_id: org.id,
      });
      restaurantIds.set(action.restaurant.slug, created.id);
      applied += 1;
      continue;
    }
    if (action.kind === 'update_restaurant') {
      await args.exec.updateRestaurant(action.restaurant_id, action.patch);
      applied += 1;
      continue;
    }
    if (action.kind === 'pause_duplicate') {
      if (action.method === 'retire_restaurant') {
        const retired = await args.exec.retireRestaurant(action.restaurant_id, args.actorId);
        if (!retired.ok || retired.result !== 'paused') {
          throw new Error(retired.error ?? 'retire_restaurant did not pause the duplicate');
        }
      } else {
        await args.exec.pauseRestaurant(action.restaurant_id, args.actorId, {
          keep_slug: action.keep_slug,
          drop_slug: action.slug,
        });
      }
      applied += 1;
      continue;
    }
    if (action.kind === 'publish_offer') {
      const restaurantId = action.restaurant_id ?? restaurantIds.get(action.restaurant_slug);
      if (!restaurantId) throw new Error(`catalog apply missing restaurant ${action.restaurant_slug}`);
      const draft = await args.exec.upsertDraft({
        restaurant_id: restaurantId,
        terms: action.terms,
        exclusions: action.exclusions,
      });
      const published = await args.exec.publishOfferVersion(draft.id, args.actorId);
      if (!published.published || !published.versionId) {
        throw new Error(published.error ?? 'publish_offer_version failed');
      }
      if (action.is_test) {
        try {
          await args.exec.insertTestMark(published.versionId, args.actorId, {
            is_test: true,
            source: action.source,
            restaurant_id: restaurantId,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'test mark failed';
          let withdrawn: { withdrawn: boolean; error?: string };
          try {
            withdrawn = await args.exec.withdrawOfferVersion(published.versionId, args.actorId);
          } catch (withdrawError) {
            const withdrawReason =
              withdrawError instanceof Error ? withdrawError.message : 'withdraw failed';
            throw new Error(
              `catalog apply failed to mark test offer ${published.versionId} (${reason}); withdraw_offer_version failed: ${withdrawReason}`,
            );
          }
          if (!withdrawn.withdrawn) {
            throw new Error(
              `catalog apply failed to mark test offer ${published.versionId} (${reason}); withdraw_offer_version failed: ${withdrawn.error ?? 'unknown'}`,
            );
          }
          throw new Error(
            `catalog apply failed to mark test offer ${published.versionId} (${reason}); withdrew version ${published.versionId}`,
          );
        }
      }
      applied += 1;
      continue;
    }
    const withdrawn = await args.exec.withdrawOfferVersion(action.version_id, args.actorId);
    if (!withdrawn.withdrawn) throw new Error(withdrawn.error ?? 'withdraw_offer_version failed');
    applied += 1;
  }
  return { applied };
}

export function importRowsFromSnapshot(snapshot: CatalogDbSnapshot, marketSlug: string): {
  rows: Record<string, string | number | boolean | null>[];
  warnings: string[];
} {
  const market = snapshot.markets.find((entry) => entry.slug === marketSlug);
  const warnings: string[] = [];
  if (!market) return { rows: [], warnings: [`market ${marketSlug} does not exist`] };
  const rows = snapshot.restaurants
    .filter((restaurant) => restaurant.market_id === market.id)
    .sort((left, right) => (left.slug ?? left.name).localeCompare(right.slug ?? right.name))
    .map((restaurant) => {
      const zip = zipFromAddress(restaurant.address);
      if (!zip) warnings.push(`${restaurant.slug ?? restaurant.name} has no 5-digit ZIP in the address`);
      const cityMatch = restaurant.address?.match(/,\s*([^,]+),\s*[A-Z]{2}\s+\d{5}\b/);
      return {
        market_slug: market.slug,
        market_name: market.name,
        market_state: market.state,
        market_timezone: market.timezone,
        name: restaurant.name,
        slug: restaurant.slug,
        address: restaurant.address,
        city: cityMatch?.[1]?.trim() || market.name,
        zip,
        lat: restaurant.lat,
        lon: restaurant.lon,
        google_place_id: restaurant.google_place_id,
        cuisine_tags: (restaurant.cuisine_tags ?? []).join('|'),
        is_vegan: restaurant.is_vegan,
        is_dairy_free: restaurant.is_dairy_free,
        is_halal: restaurant.is_halal,
        price_range: restaurant.price_range,
        neighborhood: restaurant.neighborhood,
        status: restaurant.status ?? 'active',
      };
    });
  return { rows, warnings };
}

function takeValue(argv: string[], index: number, flag: string): { value: string; index: number } {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`catalog import ${flag} needs a value`);
  return { value, index: index + 1 };
}

export function parseCatalogImportArgs(argv: string[]): CatalogCliArgs {
  const args: CatalogCliArgs = {
    mode: 'plan',
    file: null,
    planFile: null,
    planOutput: DEFAULT_PLAN_OUTPUT,
    actor: null,
    confirm: [],
    skipInvalid: false,
    refreshCoordinates: false,
    testOffers: false,
    testOffersAllInMarket: false,
    publishRealOffers: false,
    withdrawTestOffers: false,
    testOfferCapacity: DEFAULT_TEST_OFFER_CAPACITY,
    resolveDuplicates: [],
    markets: [],
    fromDbMarket: null,
    format: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') continue;
    if (arg === '--apply') {
      args.mode = 'apply';
      continue;
    }
    if (arg === '--skip-invalid') {
      args.skipInvalid = true;
      continue;
    }
    if (arg === '--refresh-coordinates') {
      args.refreshCoordinates = true;
      continue;
    }
    if (arg === '--test-offers') {
      args.testOffers = true;
      continue;
    }
    if (arg === '--test-offers-all-in-market') {
      args.testOffers = true;
      args.testOffersAllInMarket = true;
      continue;
    }
    if (arg === '--publish-real-offers') {
      args.publishRealOffers = true;
      continue;
    }
    if (arg === '--withdraw-test-offers') {
      args.withdrawTestOffers = true;
      continue;
    }
    if (arg === '--file' || arg === '--plan-file' || arg === '--plan-output' || arg === '--actor' || arg === '--format') {
      const next = takeValue(argv, index, arg);
      index = next.index;
      if (arg === '--file') args.file = next.value;
      else if (arg === '--plan-file') args.planFile = next.value;
      else if (arg === '--plan-output') args.planOutput = next.value;
      else if (arg === '--actor') args.actor = next.value;
      else if (next.value === 'csv' || next.value === 'json') args.format = next.value;
      else throw new Error('catalog import --format must be csv or json');
      continue;
    }
    if (arg === '--confirm' || arg === '--market' || arg === '--from-db' || arg === '--test-offer-capacity') {
      const next = takeValue(argv, index, arg);
      index = next.index;
      if (arg === '--confirm') {
        args.confirm.push(
          ...next.value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean),
        );
      } else if (arg === '--market') args.markets.push(next.value.trim());
      else if (arg === '--from-db') {
        args.mode = 'from-db';
        args.fromDbMarket = next.value.trim();
      } else if (!/^[1-9]\d*$/.test(next.value)) {
        throw new Error('catalog import --test-offer-capacity needs a positive integer');
      } else args.testOfferCapacity = Number(next.value);
      continue;
    }
    if (arg === '--resolve-duplicate') {
      let keep = '';
      let drop = '';
      while (argv[index + 1] && !argv[index + 1]?.startsWith('--')) {
        index += 1;
        const part = argv[index] ?? '';
        if (part.startsWith('keep=')) keep = part.slice(5);
        else if (part.startsWith('drop=')) drop = part.slice(5);
        else throw new Error('catalog import --resolve-duplicate expects keep=<slug> drop=<slug>');
      }
      if (!keep || !drop) throw new Error('catalog import --resolve-duplicate expects keep=<slug> drop=<slug>');
      args.resolveDuplicates.push({ keep, drop });
      continue;
    }
    throw new Error(`catalog import unknown argument ${arg ?? ''}`);
  }
  return args;
}
