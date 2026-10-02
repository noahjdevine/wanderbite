import { z } from 'zod';

export const CATALOG_CONVERSION_SCHEMA = 'wanderbite.e02.catalog_conversion.v1';
export const SYNTHETIC_CATALOG_CONVERSION_SCHEMA =
  'wanderbite.e02.catalog_conversion.synthetic.v1';

const instant = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'instant');
const uuid = z.string().uuid();
const nullableText = z.string().nullable();

const tierSchema = z
  .object({
    threshold_cents: z.number().int(),
    discount_cents: z.number().int(),
  })
  .strict();

const datedBoostSchema = z
  .object({
    id: z.string(),
    kind: z.literal('dated'),
    start: z.string(),
    end: z.string(),
    bonus_cents: z.number().int(),
  })
  .strict();

const weeklyBoostSchema = z
  .object({
    id: z.string(),
    kind: z.literal('weekly'),
    start_isodow: z.number().int(),
    start_minute: z.number().int(),
    end_minute: z.number().int(),
    bonus_cents: z.number().int(),
  })
  .strict();

const boostSchema = z.discriminatedUnion('kind', [datedBoostSchema, weeklyBoostSchema]);
const exclusionsSchema = z
  .object({
    exclude_tax: z.boolean(),
    exclude_tip: z.boolean(),
    categories: z.array(z.string()),
  })
  .strict();

const marketSchema = z
  .object({
    id: uuid,
    slug: z.literal('mckinney-tx'),
    status: z.string().nullable(),
    timezone: z.string().nullable(),
  })
  .strict();

const restaurantSchema = z
  .object({
    id: uuid,
    slug: nullableText,
    name: z.string(),
    status: nullableText,
    market_id: uuid.nullable(),
    address: nullableText,
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    google_place_id: nullableText,
    current_offer_version_id: uuid.nullable(),
  })
  .strict();

const legacyOfferSchema = z
  .object({
    id: uuid,
    restaurant_id: uuid.nullable(),
    discount_amount_cents: z.number().int().nullable(),
    min_spend_cents: z.number().int().nullable(),
    max_redemptions_per_month: z.number().int().nullable(),
    active: z.boolean().nullable(),
    created_at: instant.nullable(),
  })
  .strict();

const offerVersionSchema = z
  .object({
    id: uuid,
    restaurant_id: uuid,
    timezone: z.string(),
    valid_from: instant,
    valid_until: instant,
    tiers: z.array(tierSchema),
    boosts: z.array(boostSchema),
    exclusions: exclusionsSchema,
    capacity_timezone: z.string(),
    capacity_window_kind: z.string(),
    capacity_max_redemptions: z.number().int(),
    boost_session_minutes: z.number().int().nullable(),
    withdrawn_from_selection_at: instant.nullable(),
    published_at: instant,
    published_by: uuid.nullable(),
  })
  .strict();

const decisionSchema = z
  .object({
    restaurant_id: uuid,
    timezone: nullableText,
    valid_from: nullableText,
    valid_until: nullableText,
    exclusions: exclusionsSchema.nullable(),
    boosts: z.array(boostSchema).nullable(),
    capacity_timezone: nullableText,
    capacity_max_redemptions_approved: z.boolean().nullable(),
    boost_session_minutes: z.number().int().nullable(),
    publication_approved: z.boolean().nullable(),
    provenance_ref: nullableText,
  })
  .strict();

const coordinateDecisionSchema = z
  .object({
    restaurant_id: uuid,
    lat: z.number().nullable(),
    lon: z.number().nullable(),
    provenance_ref: nullableText,
  })
  .strict();

const mockMatchSchema = z
  .object({
    place_id: z.string(),
    name: z.string(),
    address: z.string(),
    lat: z.number(),
    lon: z.number(),
  })
  .strict();

const mockCoordinateResultSchema = z
  .object({
    restaurant_id: uuid,
    mode: z.enum(['place_id', 'search']),
    matches: z.array(mockMatchSchema),
  })
  .strict();

const commonInputShape = {
  exported_at: instant,
  evaluation_at: instant,
  evaluation_at_provenance: z.string().min(1),
  launch_market: marketSchema,
  restaurants: z.array(restaurantSchema),
  legacy_offers: z.array(legacyOfferSchema),
  offer_versions: z.array(offerVersionSchema),
  decisions: z.array(decisionSchema),
  coordinate_decisions: z.array(coordinateDecisionSchema),
};

const realInputSchema = z
  .object({
    schema: z.literal(CATALOG_CONVERSION_SCHEMA),
    ...commonInputShape,
  })
  .strict();

const syntheticInputSchema = z
  .object({
    schema: z.literal(SYNTHETIC_CATALOG_CONVERSION_SCHEMA),
    ...commonInputShape,
    mock_coordinate_results: z.array(mockCoordinateResultSchema),
  })
  .strict();

export type CatalogConversionInput = z.infer<typeof realInputSchema>;
export type SyntheticCatalogConversionInput = z.infer<typeof syntheticInputSchema>;
type AnyCatalogConversionInput = CatalogConversionInput | SyntheticCatalogConversionInput;
type Restaurant = CatalogConversionInput['restaurants'][number];
type LegacyOffer = CatalogConversionInput['legacy_offers'][number];
type OfferVersion = CatalogConversionInput['offer_versions'][number];
type Decision = CatalogConversionInput['decisions'][number];
type CoordinateDecision = CatalogConversionInput['coordinate_decisions'][number];
export type OfferTierTerms = z.infer<typeof tierSchema>;
export type OfferBoostTerms = z.infer<typeof boostSchema>;

export type OfferVersionTerms = {
  tiers: OfferTierTerms[];
  boosts: OfferBoostTerms[];
  timezone: string | null;
  valid_from: string | null;
  valid_until: string | null;
  capacity_timezone: string | null;
  capacity_window_kind: string | null;
  capacity_max_redemptions: number | null;
};

export type ConversionStatus = 'ready' | 'blocked' | 'already-versioned' | 'ambiguous';
export type ValidityReason =
  | 'ok'
  | 'invalid'
  | 'not_yet_valid'
  | 'expires_before_deadline'
  | 'withdrawn';
export type GeographyReason =
  | 'ok'
  | 'outside_market'
  | 'inactive'
  | 'missing_coordinates'
  | 'partial_coordinates'
  | 'invalid_coordinates'
  | 'mock_proposed'
  | 'mock_ambiguous';

export type CatalogConversionRow = {
  restaurant_id: string;
  status: ConversionStatus;
  source_legacy_offer_id: string | null;
  current_offer_version_id: string | null;
  proposed_terms: {
    tiers: OfferTierTerms[];
    boosts: OfferBoostTerms[];
    timezone: string | null;
    valid_from: string | null;
    valid_until: string | null;
    exclusions: z.infer<typeof exclusionsSchema> | null;
    capacity_timezone: string | null;
    capacity_window_kind: 'calendar_month';
    capacity_max_redemptions: number | null;
    boost_session_minutes: number | null;
  } | null;
  provenance: {
    tier: string | null;
    capacity: string | null;
    partner_terms: string | null;
    coordinates: string | null;
  };
  unresolved_decisions: string[];
  diagnostics: {
    publication: { ok: boolean; reason: string | null };
    validity: { ok: boolean; reason: ValidityReason };
    geography: { ok: boolean; reason: GeographyReason };
    pair_candidate: boolean;
    carried_candidate: boolean;
  };
  coordinates: {
    status: 'preserved' | 'reviewed' | 'missing' | 'partial' | 'invalid' | 'mock_proposed' | 'mock_ambiguous';
    lat: number | null;
    lon: number | null;
  };
  base_discount_cents: number | null;
};

export type CatalogConversionManifest = {
  schema: 'wanderbite.e02.catalog_conversion_manifest.v1';
  source_schema: string;
  exported_at: string;
  evaluation_at: string;
  evaluation_at_provenance: string;
  synthetic: boolean;
  restaurants: CatalogConversionRow[];
  diagnostics: {
    counts: Record<ConversionStatus, number>;
    publication_failures: number;
    validity_failures: number;
    geography_failures: number;
    pair: {
      passes: boolean;
      distinct_candidates: number;
      qualifying_pairs: number;
      floor_cents: 2000;
    };
    carried: {
      passes: boolean;
      qualifying_restaurants: number;
      floor_cents: 2000;
    };
  };
};

export type ParseResult<T> = { ok: true; input: T } | { ok: false; message: string };

const forbiddenKey = /(?:secret|password|token|pin|verification|member|user_profile|photo)/i;

function containsForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, entry]) => forbiddenKey.test(key) || containsForbiddenKey(entry),
  );
}

function pathText(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return '(root)';
  return path.reduce<string>((out, part) => {
    if (typeof part === 'number') return `${out}[${part}]`;
    return out ? `${out}.${String(part)}` : String(part);
  }, '');
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): ParseResult<T> {
  if (containsForbiddenKey(raw)) {
    return { ok: false, message: 'catalog conversion input rejected: forbidden key' };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const paths = [...new Set(parsed.error.issues.map((issue) => pathText(issue.path)))];
    return {
      ok: false,
      message: `catalog conversion input rejected: ${paths.join(', ')}`,
    };
  }
  return { ok: true, input: parsed.data };
}

export function parseCatalogConversionInput(raw: unknown): ParseResult<CatalogConversionInput> {
  return parseWith(realInputSchema, raw);
}

export function parseSyntheticCatalogConversionInput(
  raw: unknown,
): ParseResult<SyntheticCatalogConversionInput> {
  return parseWith(syntheticInputSchema, raw);
}

function validTimezone(value: string | null): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mirrors the ordered checks in public.offer_version_terms_ok.
 * Disposable Postgres parity tests keep this diagnostic helper subordinate to SQL.
 */
export function offerVersionTermsProblem(terms: OfferVersionTerms): string | null {
  if (terms.capacity_window_kind !== 'calendar_month') return 'capacity_window_kind';
  if (
    terms.capacity_max_redemptions == null ||
    !Number.isInteger(terms.capacity_max_redemptions) ||
    terms.capacity_max_redemptions <= 0
  ) {
    return 'capacity_max_redemptions';
  }
  if (!validTimezone(terms.timezone)) return 'timezone';
  if (!validTimezone(terms.capacity_timezone)) return 'capacity_timezone';
  const validFrom = terms.valid_from == null ? Number.NaN : Date.parse(terms.valid_from);
  const validUntil = terms.valid_until == null ? Number.NaN : Date.parse(terms.valid_until);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validUntil) || validUntil <= validFrom) {
    return 'validity';
  }
  if (terms.tiers.length < 1) return 'tiers';
  let previousThreshold = 0;
  let previousDiscount = 0;
  for (const tier of terms.tiers) {
    const threshold = tier.threshold_cents;
    const discount = tier.discount_cents;
    if (
      !Number.isInteger(threshold) ||
      !Number.isInteger(discount) ||
      threshold <= 0 ||
      discount <= 0
    ) {
      return 'tier_cents';
    }
    if (discount > threshold) return 'tier_above_threshold';
    if (
      previousThreshold !== 0 &&
      (threshold <= previousThreshold || discount < previousDiscount)
    ) {
      return 'tier_order';
    }
    previousThreshold = threshold;
    previousDiscount = discount;
  }
  for (const boost of terms.boosts) {
    if (!Number.isInteger(boost.bonus_cents) || boost.bonus_cents <= 0) {
      return 'boost_cents';
    }
    if (!boost.id) return 'boost_id';
  }
  return null;
}

export const OFFER_VERSION_TERMS_PARITY_CASES: ReadonlyArray<{
  name: string;
  terms: OfferVersionTerms;
  expected: string | null;
}> = [
  {
    name: 'valid',
    terms: {
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      boosts: [],
      timezone: 'America/Chicago',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'calendar_month',
      capacity_max_redemptions: 50,
    },
    expected: null,
  },
  {
    name: 'window kind',
    terms: {
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      boosts: [],
      timezone: 'America/Chicago',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'rolling',
      capacity_max_redemptions: 50,
    },
    expected: 'capacity_window_kind',
  },
  {
    name: 'capacity',
    terms: {
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      boosts: [],
      timezone: 'America/Chicago',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'calendar_month',
      capacity_max_redemptions: 0,
    },
    expected: 'capacity_max_redemptions',
  },
  {
    name: 'timezone',
    terms: {
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      boosts: [],
      timezone: 'Not/A_Timezone',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'calendar_month',
      capacity_max_redemptions: 50,
    },
    expected: 'timezone',
  },
  {
    name: 'capacity timezone',
    terms: {
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      boosts: [],
      timezone: 'America/Chicago',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
      capacity_timezone: 'Not/A_Timezone',
      capacity_window_kind: 'calendar_month',
      capacity_max_redemptions: 50,
    },
    expected: 'capacity_timezone',
  },
  {
    name: 'validity',
    terms: {
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      boosts: [],
      timezone: 'America/Chicago',
      valid_from: '2027-01-01T00:00:00.000Z',
      valid_until: '2026-01-01T00:00:00.000Z',
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'calendar_month',
      capacity_max_redemptions: 50,
    },
    expected: 'validity',
  },
  {
    name: 'tiers',
    terms: {
      tiers: [],
      boosts: [],
      timezone: 'America/Chicago',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'calendar_month',
      capacity_max_redemptions: 50,
    },
    expected: 'tiers',
  },
  {
    name: 'tier cents',
    terms: {
      tiers: [{ threshold_cents: 4000, discount_cents: 0 }],
      boosts: [],
      timezone: 'America/Chicago',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'calendar_month',
      capacity_max_redemptions: 50,
    },
    expected: 'tier_cents',
  },
  {
    name: 'tier above threshold',
    terms: {
      tiers: [{ threshold_cents: 1000, discount_cents: 2000 }],
      boosts: [],
      timezone: 'America/Chicago',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'calendar_month',
      capacity_max_redemptions: 50,
    },
    expected: 'tier_above_threshold',
  },
  {
    name: 'tier order',
    terms: {
      tiers: [
        { threshold_cents: 4000, discount_cents: 1000 },
        { threshold_cents: 3000, discount_cents: 1500 },
      ],
      boosts: [],
      timezone: 'America/Chicago',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'calendar_month',
      capacity_max_redemptions: 50,
    },
    expected: 'tier_order',
  },
  {
    name: 'boost cents',
    terms: {
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      boosts: [
        {
          id: 'weekday',
          kind: 'dated',
          start: '2026-01-01T00:00:00.000Z',
          end: '2026-01-02T00:00:00.000Z',
          bonus_cents: 0,
        },
      ],
      timezone: 'America/Chicago',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'calendar_month',
      capacity_max_redemptions: 50,
    },
    expected: 'boost_cents',
  },
  {
    name: 'boost id',
    terms: {
      tiers: [{ threshold_cents: 4000, discount_cents: 1000 }],
      boosts: [
        {
          id: '',
          kind: 'dated',
          start: '2026-01-01T00:00:00.000Z',
          end: '2026-01-02T00:00:00.000Z',
          bonus_cents: 100,
        },
      ],
      timezone: 'America/Chicago',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: '2027-01-01T00:00:00.000Z',
      capacity_timezone: 'America/Chicago',
      capacity_window_kind: 'calendar_month',
      capacity_max_redemptions: 50,
    },
    expected: 'boost_id',
  },
];

function validCoordinates(lat: number | null, lon: number | null): boolean {
  return (
    lat != null &&
    lon != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function normalized(value: string | null): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function coordinateResult(
  input: AnyCatalogConversionInput,
  restaurant: Restaurant,
  reviewed: CoordinateDecision | undefined,
): {
  coordinates: CatalogConversionRow['coordinates'];
  geography: CatalogConversionRow['diagnostics']['geography'];
  provenance: string | null;
  ambiguous: boolean;
} {
  if (restaurant.status !== 'active') {
    return {
      coordinates: { status: 'missing', lat: restaurant.lat, lon: restaurant.lon },
      geography: { ok: false, reason: 'inactive' },
      provenance: null,
      ambiguous: false,
    };
  }
  if (restaurant.market_id !== input.launch_market.id) {
    return {
      coordinates: { status: 'missing', lat: restaurant.lat, lon: restaurant.lon },
      geography: { ok: false, reason: 'outside_market' },
      provenance: null,
      ambiguous: false,
    };
  }
  if (validCoordinates(restaurant.lat, restaurant.lon)) {
    return {
      coordinates: { status: 'preserved', lat: restaurant.lat, lon: restaurant.lon },
      geography: { ok: true, reason: 'ok' },
      provenance: 'conversion_export',
      ambiguous: false,
    };
  }
  if (
    reviewed?.provenance_ref &&
    validCoordinates(reviewed.lat, reviewed.lon)
  ) {
    return {
      coordinates: { status: 'reviewed', lat: reviewed.lat, lon: reviewed.lon },
      geography: { ok: true, reason: 'ok' },
      provenance: reviewed.provenance_ref,
      ambiguous: false,
    };
  }

  const oneSided = (restaurant.lat == null) !== (restaurant.lon == null);
  const baseStatus = oneSided
    ? ('partial' as const)
    : restaurant.lat == null && restaurant.lon == null
      ? ('missing' as const)
      : ('invalid' as const);
  const baseReason = oneSided
    ? ('partial_coordinates' as const)
    : restaurant.lat == null && restaurant.lon == null
      ? ('missing_coordinates' as const)
      : ('invalid_coordinates' as const);

  if (input.schema !== SYNTHETIC_CATALOG_CONVERSION_SCHEMA) {
    return {
      coordinates: { status: baseStatus, lat: restaurant.lat, lon: restaurant.lon },
      geography: { ok: false, reason: baseReason },
      provenance: null,
      ambiguous: false,
    };
  }

  const mock = input.mock_coordinate_results.find(
    (entry) => entry.restaurant_id === restaurant.id,
  );
  if (!mock) {
    return {
      coordinates: { status: baseStatus, lat: restaurant.lat, lon: restaurant.lon },
      geography: { ok: false, reason: baseReason },
      provenance: null,
      ambiguous: false,
    };
  }
  const matches = mock.matches.filter((candidate) => {
    if (!validCoordinates(candidate.lat, candidate.lon)) return false;
    if (mock.mode === 'place_id') {
      return Boolean(
        restaurant.google_place_id && candidate.place_id === restaurant.google_place_id,
      );
    }
    return (
      normalized(candidate.name) === normalized(restaurant.name) &&
      normalized(candidate.address) === normalized(restaurant.address)
    );
  });
  if (matches.length === 1) {
    return {
      coordinates: {
        status: 'mock_proposed',
        lat: matches[0]?.lat ?? null,
        lon: matches[0]?.lon ?? null,
      },
      geography: { ok: true, reason: 'mock_proposed' },
      provenance: 'synthetic_mock',
      ambiguous: false,
    };
  }
  if (matches.length > 1) {
    return {
      coordinates: { status: 'mock_ambiguous', lat: null, lon: null },
      geography: { ok: false, reason: 'mock_ambiguous' },
      provenance: 'synthetic_mock',
      ambiguous: true,
    };
  }
  return {
    coordinates: { status: baseStatus, lat: restaurant.lat, lon: restaurant.lon },
    geography: { ok: false, reason: baseReason },
    provenance: 'synthetic_mock',
    ambiguous: false,
  };
}

function validityResult(args: {
  validFrom: string | null;
  validUntil: string | null;
  withdrawnAt: string | null;
  evaluationAt: string;
}): { ok: boolean; reason: ValidityReason } {
  const start = args.validFrom == null ? Number.NaN : Date.parse(args.validFrom);
  const end = args.validUntil == null ? Number.NaN : Date.parse(args.validUntil);
  const evaluation = Date.parse(args.evaluationAt);
  const deadline = evaluation + 840 * 60 * 60 * 1000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { ok: false, reason: 'invalid' };
  }
  if (args.withdrawnAt) return { ok: false, reason: 'withdrawn' };
  if (start > evaluation) return { ok: false, reason: 'not_yet_valid' };
  if (end <= deadline) return { ok: false, reason: 'expires_before_deadline' };
  return { ok: true, reason: 'ok' };
}

function lowestTier(tiers: OfferTierTerms[]): OfferTierTerms | null {
  return [...tiers].sort((a, b) => a.threshold_cents - b.threshold_cents)[0] ?? null;
}

function duplicateIds<T extends { restaurant_id: string }>(rows: T[]): Set<string> {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.restaurant_id)) duplicate.add(row.restaurant_id);
    seen.add(row.restaurant_id);
  }
  return duplicate;
}

function rowForRestaurant(
  input: AnyCatalogConversionInput,
  restaurant: Restaurant,
  legacyOffers: LegacyOffer[],
  versions: OfferVersion[],
  decision: Decision | undefined,
  coordinateDecision: CoordinateDecision | undefined,
  duplicateDecisionIds: Set<string>,
  duplicateCoordinateDecisionIds: Set<string>,
): CatalogConversionRow {
  const unresolved = new Set<string>();
  const coordinates = coordinateResult(input, restaurant, coordinateDecision);
  if (!coordinates.geography.ok) unresolved.add(`geography:${coordinates.geography.reason}`);
  if (duplicateCoordinateDecisionIds.has(restaurant.id)) {
    unresolved.add('coordinates:multiple_reviewed_decisions');
  }

  let status: ConversionStatus = 'blocked';
  let source: LegacyOffer | null = null;
  let proposedTerms: CatalogConversionRow['proposed_terms'] = null;
  let publicationReason: string | null = null;
  let validity = { ok: false, reason: 'invalid' as ValidityReason };
  let baseDiscount: number | null = null;
  let tierProvenance: string | null = null;
  let capacityProvenance: string | null = null;
  let partnerProvenance: string | null = decision?.provenance_ref ?? null;

  if (restaurant.current_offer_version_id) {
    const current = versions.filter(
      (version) =>
        version.id === restaurant.current_offer_version_id &&
        version.restaurant_id === restaurant.id,
    );
    if (current.length !== 1) {
      status = 'ambiguous';
      unresolved.add('current_version:missing_or_ambiguous');
    } else {
      const version = current[0]!;
      status = 'already-versioned';
      publicationReason = offerVersionTermsProblem({
        tiers: version.tiers,
        boosts: version.boosts,
        timezone: version.timezone,
        valid_from: version.valid_from,
        valid_until: version.valid_until,
        capacity_timezone: version.capacity_timezone,
        capacity_window_kind: version.capacity_window_kind,
        capacity_max_redemptions: version.capacity_max_redemptions,
      });
      validity = validityResult({
        validFrom: version.valid_from,
        validUntil: version.valid_until,
        withdrawnAt: version.withdrawn_from_selection_at,
        evaluationAt: input.evaluation_at,
      });
      baseDiscount = lowestTier(version.tiers)?.discount_cents ?? null;
      tierProvenance = `offer_version:${version.id}`;
      capacityProvenance = `offer_version:${version.id}`;
      partnerProvenance = `offer_version:${version.id}`;
    }
  } else if (legacyOffers.length > 1) {
    status = 'ambiguous';
    unresolved.add('legacy_offer:multiple');
  } else if (legacyOffers.length === 0) {
    unresolved.add('legacy_offer:missing');
  } else {
    source = legacyOffers[0]!;
    tierProvenance = `legacy_offer:${source.id}`;
    capacityProvenance = `legacy_offer:${source.id}:unapproved`;
    if (source.active !== true) unresolved.add('legacy_offer:inactive');
    const tier =
      source.min_spend_cents == null || source.discount_amount_cents == null
        ? null
        : {
            threshold_cents: source.min_spend_cents,
            discount_cents: source.discount_amount_cents,
          };
    if (!tier) unresolved.add('legacy_offer:missing_cents');
    if (duplicateDecisionIds.has(restaurant.id)) {
      unresolved.add('partner_terms:multiple_decisions');
    }
    if (!decision) {
      unresolved.add('partner_terms:missing');
    } else {
      if (!decision.provenance_ref) unresolved.add('partner_terms:missing_provenance');
      if (!decision.timezone) unresolved.add('partner_terms:missing_timezone');
      if (!decision.valid_from || !decision.valid_until) {
        unresolved.add('partner_terms:missing_validity');
      }
      if (!decision.exclusions) unresolved.add('partner_terms:missing_exclusions');
      if (!decision.boosts) unresolved.add('partner_terms:missing_boost_decision');
      if (!decision.capacity_timezone) {
        unresolved.add('partner_terms:missing_capacity_timezone');
      }
      if (decision.capacity_max_redemptions_approved !== true) {
        unresolved.add('capacity:reviewed_approval_required');
      }
      if (decision.publication_approved !== true) {
        unresolved.add('publication:reviewed_approval_required');
      }
    }
    proposedTerms = tier
      ? {
          tiers: [tier],
          boosts: decision?.boosts ?? [],
          timezone: decision?.timezone ?? null,
          valid_from: decision?.valid_from ?? null,
          valid_until: decision?.valid_until ?? null,
          exclusions: decision?.exclusions ?? null,
          capacity_timezone: decision?.capacity_timezone ?? null,
          capacity_window_kind: 'calendar_month',
          capacity_max_redemptions: source.max_redemptions_per_month,
          boost_session_minutes: decision?.boost_session_minutes ?? null,
        }
      : null;
    if (proposedTerms) {
      publicationReason = offerVersionTermsProblem({
        tiers: proposedTerms.tiers,
        boosts: proposedTerms.boosts,
        timezone: proposedTerms.timezone,
        valid_from: proposedTerms.valid_from,
        valid_until: proposedTerms.valid_until,
        capacity_timezone: proposedTerms.capacity_timezone,
        capacity_window_kind: proposedTerms.capacity_window_kind,
        capacity_max_redemptions: proposedTerms.capacity_max_redemptions,
      });
      validity = validityResult({
        validFrom: proposedTerms.valid_from,
        validUntil: proposedTerms.valid_until,
        withdrawnAt: null,
        evaluationAt: input.evaluation_at,
      });
      baseDiscount = lowestTier(proposedTerms.tiers)?.discount_cents ?? null;
    }
    if (publicationReason) unresolved.add(`publication:${publicationReason}`);
    if (!validity.ok) unresolved.add(`validity:${validity.reason}`);
    if (coordinates.ambiguous) status = 'ambiguous';
    else if (unresolved.size === 0 && coordinates.geography.ok && source.active === true) {
      status = 'ready';
    }
  }

  const publicationOk = publicationReason == null && status !== 'ambiguous';
  const selectable =
    (status === 'ready' || status === 'already-versioned') &&
    publicationOk &&
    validity.ok &&
    coordinates.geography.ok &&
    baseDiscount != null;

  return {
    restaurant_id: restaurant.id,
    status,
    source_legacy_offer_id: source?.id ?? null,
    current_offer_version_id: restaurant.current_offer_version_id,
    proposed_terms: proposedTerms,
    provenance: {
      tier: tierProvenance,
      capacity: capacityProvenance,
      partner_terms: partnerProvenance,
      coordinates: coordinates.provenance,
    },
    unresolved_decisions: [...unresolved].sort(),
    diagnostics: {
      publication: { ok: publicationOk, reason: publicationReason },
      validity,
      geography: coordinates.geography,
      pair_candidate: selectable,
      carried_candidate: selectable && baseDiscount != null && baseDiscount >= 2000,
    },
    coordinates: coordinates.coordinates,
    base_discount_cents: baseDiscount,
  };
}

export function buildCatalogConversionManifest(
  input: AnyCatalogConversionInput,
): CatalogConversionManifest {
  const decisionsByRestaurant = new Map(
    input.decisions.map((decision) => [decision.restaurant_id, decision]),
  );
  const coordinateDecisionsByRestaurant = new Map(
    input.coordinate_decisions.map((decision) => [decision.restaurant_id, decision]),
  );
  const duplicateDecisionIds = duplicateIds(input.decisions);
  const duplicateCoordinateDecisionIds = duplicateIds(input.coordinate_decisions);
  const rows = input.restaurants
    .map((restaurant) =>
      rowForRestaurant(
        input,
        restaurant,
        input.legacy_offers.filter((offer) => offer.restaurant_id === restaurant.id),
        input.offer_versions,
        decisionsByRestaurant.get(restaurant.id),
        coordinateDecisionsByRestaurant.get(restaurant.id),
        duplicateDecisionIds,
        duplicateCoordinateDecisionIds,
      ),
    )
    .sort((a, b) => a.restaurant_id.localeCompare(b.restaurant_id));

  const pairCandidates = rows.filter(
    (row) => row.diagnostics.pair_candidate && row.base_discount_cents != null,
  );
  let qualifyingPairs = 0;
  for (let left = 0; left < pairCandidates.length; left += 1) {
    for (let right = left + 1; right < pairCandidates.length; right += 1) {
      const a = pairCandidates[left]!;
      const b = pairCandidates[right]!;
      if (
        a.restaurant_id !== b.restaurant_id &&
        (a.base_discount_cents ?? 0) + (b.base_discount_cents ?? 0) >= 2000
      ) {
        qualifyingPairs += 1;
      }
    }
  }
  const carriedCandidates = rows.filter((row) => row.diagnostics.carried_candidate);
  const counts: Record<ConversionStatus, number> = {
    ready: 0,
    blocked: 0,
    'already-versioned': 0,
    ambiguous: 0,
  };
  for (const row of rows) counts[row.status] += 1;

  return {
    schema: 'wanderbite.e02.catalog_conversion_manifest.v1',
    source_schema: input.schema,
    exported_at: input.exported_at,
    evaluation_at: input.evaluation_at,
    evaluation_at_provenance: input.evaluation_at_provenance,
    synthetic: input.schema === SYNTHETIC_CATALOG_CONVERSION_SCHEMA,
    restaurants: rows,
    diagnostics: {
      counts,
      publication_failures: rows.filter((row) => !row.diagnostics.publication.ok).length,
      validity_failures: rows.filter((row) => !row.diagnostics.validity.ok).length,
      geography_failures: rows.filter((row) => !row.diagnostics.geography.ok).length,
      pair: {
        passes: qualifyingPairs > 0,
        distinct_candidates: new Set(pairCandidates.map((row) => row.restaurant_id)).size,
        qualifying_pairs: qualifyingPairs,
        floor_cents: 2000,
      },
      carried: {
        passes: carriedCandidates.length > 0,
        qualifying_restaurants: carriedCandidates.length,
        floor_cents: 2000,
      },
    },
  };
}

export function formatCatalogConversionSummary(manifest: CatalogConversionManifest): string {
  const counts = manifest.diagnostics.counts;
  return [
    `catalog_conversion evaluation_at=${manifest.evaluation_at}`,
    `restaurants=${manifest.restaurants.length}`,
    `ready=${counts.ready}`,
    `blocked=${counts.blocked}`,
    `already_versioned=${counts['already-versioned']}`,
    `ambiguous=${counts.ambiguous}`,
    `publication_failures=${manifest.diagnostics.publication_failures}`,
    `validity_failures=${manifest.diagnostics.validity_failures}`,
    `geography_failures=${manifest.diagnostics.geography_failures}`,
    `pair=${manifest.diagnostics.pair.passes ? 'PASS' : 'FAIL'}`,
    `carried=${manifest.diagnostics.carried.passes ? 'PASS' : 'FAIL'}`,
  ].join(' ') + '\n';
}
