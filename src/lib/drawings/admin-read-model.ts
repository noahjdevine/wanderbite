import 'server-only';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { displayPrizeLabel, type CampaignMode } from '@/lib/drawings/campaign';
import {
  compareCreatedAt,
  isFulfillmentStatus,
  summarizeFulfillment,
  type FulfillmentStatus,
} from '@/lib/drawings/fulfillment';
import { listFulfillments } from '@/lib/drawings/fulfillment-store';
import { getSelection } from '@/lib/drawings/selection-store';

/**
 * Server-only read model for /admin/drawings.
 * Lists campaigns (getCampaign does not list, and it does not return
 * activated_at or closed_at), then reads each simulated selection and
 * its fulfillments. The returned view has no member email, no full user
 * id, and no full selection seed. This module does not write.
 */

/** PostgREST returns at most this many rows unless the read is paged. */
export const DRAWINGS_ADMIN_PAGE_SIZE = 1000;

/** user id and fulfillment id lists stay short enough for one request URL. */
const IN_CHUNK = 200;

const SEED_PREFIX = 8;
const MEMBER_PREFIX = 8;

export const DRAWINGS_NOT_SET_UP = "Drawing tables aren't set up on this database yet";

export const DRAWINGS_UNAVAILABLE = 'Drawing records are unavailable.';

export const OVER_ALLOWANCE_NOTE = 'Recorded cost is above the fulfillment allowance';

export const DELETED_MEMBER_LABEL = 'Deleted member';

const CHICAGO_CALENDAR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const DOLLAR_GROUPS = new Intl.NumberFormat('en-US');

const MISSING_RELATION_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);

export type DrawingsAdminView =
  | { ok: true; campaigns: DrawingsAdminCampaign[] }
  | { ok: false; reason: 'not_set_up' | 'unavailable' };

export type DrawingsAdminCampaign = {
  id: string;
  quarterKey: string;
  mode: CampaignMode;
  status: 'draft' | 'active' | 'closed';
  modeLabel: 'Sample' | 'Live';
  statusLabel: 'Draft' | 'Active' | 'Closed';
  activatedOn: string | null;
  closedOn: string | null;
  /** True when the raw activated_at timestamp is set. Not derived from activatedOn. */
  activatedAtSet: boolean;
  /** True when the raw closed_at timestamp is set. Not derived from closedOn. */
  closedAtSet: boolean;
  prizes: { label: string; quantity: number; unitValue: string }[];
  budgetLabel: string;
  /** Simulated selection id, when one is stored. Not a member id. */
  selectionId: string | null;
  selection: {
    seedPreview: string;
    eligibleEntryCount: number;
    unfilledUnitCount: number;
    runBy: string;
    ranOn: string | null;
  } | null;
  winners: {
    rank: number;
    prizeLabel: string;
    memberLabel: string;
    fulfillmentLabel: string;
    /** Fulfillment row id. Null when that winner has no fulfillment row. Not a member id. */
    fulfillmentId: string | null;
    /** Stored status. Null when that winner has no fulfillment row. */
    fulfillmentStatus: string | null;
    /** True when user_profiles has no row for this winner. */
    memberDeleted: boolean;
  }[];
  /** Same total as costLabel's recorded cost: summarizeFulfillment's sum, in cents. */
  recordedCostCents: number;
  /** Campaign fulfillment_allowance_cents. Not total_budget_cents. */
  allowanceCents: number;
  countsLabel: string;
  costLabel: string;
  note: string | null;
  events: { on: string | null; label: string }[];
};

export type DrawingsAdminPrizeSource = {
  id: string;
  label: string;
  quantity: number;
  unitValueCents: number;
  position: number;
};

export type DrawingsAdminSource = {
  campaign: {
    id: string;
    quarterKey: string;
    mode: CampaignMode;
    status: 'draft' | 'active' | 'closed';
    totalBudgetCents: number;
    fulfillmentAllowanceCents: number;
    activatedAt: string | null;
    closedAt: string | null;
    prizes: DrawingsAdminPrizeSource[];
  };
  selection: {
    id: string;
    seed: string;
    eligibleEntryCount: number;
    unfilledUnitCount: number;
    runBy: string;
    createdAt: string;
    winners: {
      id: string;
      rank: number;
      prizeId: string;
      userId: string;
      unitIndex: number;
    }[];
  } | null;
  fulfillments: {
    id: string;
    winnerId: string;
    prizeId: string;
    status: string;
    actualCostCents: number | null;
  }[];
  events: {
    id: string;
    fulfillmentId: string;
    toStatus: string;
    createdAt: string;
  }[];
  /** user_profiles ids that exist. Any other winner is a deleted member. */
  profileIds: ReadonlySet<string>;
};

type DbError = { message?: string; code?: string };

type PageResult = { data: unknown; error: DbError | null };

export type DrawingsAdminFilter = {
  eq: (column: string, value: string) => DrawingsAdminFilter;
  in: (column: string, values: readonly string[]) => DrawingsAdminFilter;
  order: (column: string, options?: { ascending?: boolean }) => DrawingsAdminFilter;
  range: (from: number, to: number) => Promise<PageResult>;
};

export type DrawingsAdminTable =
  | 'drawing_campaigns'
  | 'drawing_campaign_prizes'
  | 'drawing_selections'
  | 'drawing_selection_winners'
  | 'drawing_fulfillments'
  | 'drawing_fulfillment_events'
  | 'user_profiles';

export type DrawingsAdminClient = {
  from: (table: DrawingsAdminTable) => {
    select: (columns: string) => DrawingsAdminFilter;
  };
};

type SelectionLoad =
  | {
      ok: true;
      selection: NonNullable<DrawingsAdminSource['selection']>;
    }
  | { ok: false; error: 'not_found' | 'unavailable' };

type FulfillmentLoad =
  | { ok: true; fulfillments: DrawingsAdminSource['fulfillments'] }
  | { ok: false; error: 'unavailable' };

export type DrawingsAdminLoaderOptions = {
  client?: DrawingsAdminClient;
  loadSelection?: (campaignId: string) => Promise<SelectionLoad>;
  loadFulfillments?: (campaignId: string) => Promise<FulfillmentLoad>;
};

const CAMPAIGN_COLUMNS =
  'id, quarter_key, mode, status, total_budget_cents, fulfillment_allowance_cents, activated_at, closed_at';

const PRIZE_COLUMNS = 'id, campaign_id, label, quantity, unit_value_cents, position';

const EVENT_COLUMNS = 'id, fulfillment_id, to_status, created_at';

function drawingsAdminClient(): DrawingsAdminClient {
  return getSupabaseAdmin() as unknown as DrawingsAdminClient;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readWhole(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function readNonNegative(value: unknown): number | null {
  const parsed = readWhole(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

/** null is an empty timestamp. undefined means the value is not a timestamp. */
function readOptionalTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return readText(value) ?? undefined;
}

/**
 * Postgres 42P01 is undefined_table. PostgREST reports a missing table as
 * PGRST205 (schema cache). 42703 and PGRST204 are a missing column, which
 * this page treats the same way so a partial drawing schema does not throw.
 */
export function drawingRelationMissing(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  if (MISSING_RELATION_CODES.has(code)) return true;
  const message = (error.message ?? '').toLowerCase();
  if (message.length === 0) return false;
  return (
    message.includes('does not exist') ||
    message.includes('could not find the table') ||
    message.includes('could not find the column') ||
    message.includes('schema cache')
  );
}

/** America/Chicago calendar date. The process time zone is not used. */
export function formatChicagoCalendarDate(iso: string | null | undefined): string | null {
  if (typeof iso !== 'string' || iso.length === 0) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return CHICAGO_CALENDAR.format(date);
}

/** Whole cents as dollars with two decimal places. */
export function formatDrawingDollars(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const body = `$${DOLLAR_GROUPS.format(dollars)}.${String(remainder).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

function committedCents(
  allowance: number,
  prizes: readonly { quantity: number; unitValueCents: number }[],
): number | null {
  let total = allowance;
  if (!Number.isSafeInteger(total)) return null;
  for (const prize of prizes) {
    const product = prize.quantity * prize.unitValueCents;
    if (!Number.isSafeInteger(product)) return null;
    total += product;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function modeLabel(mode: CampaignMode): 'Sample' | 'Live' {
  return mode === 'sample' ? 'Sample' : 'Live';
}

function statusLabel(status: DrawingsAdminSource['campaign']['status']): 'Draft' | 'Active' | 'Closed' {
  if (status === 'draft') return 'Draft';
  if (status === 'active') return 'Active';
  return 'Closed';
}

function memberDeleted(userId: string, profileIds: ReadonlySet<string>): boolean {
  return !profileIds.has(userId);
}

function memberLabel(userId: string, profileIds: ReadonlySet<string>): string {
  if (memberDeleted(userId, profileIds)) return DELETED_MEMBER_LABEL;
  return userId.slice(0, MEMBER_PREFIX);
}

function seedPreview(seed: string): string {
  const prefix = seed.slice(0, SEED_PREFIX);
  return seed.length > SEED_PREFIX ? `${prefix}…` : prefix;
}

function fulfillmentLabel(row: { status: string; actualCostCents: number | null } | undefined): string {
  if (!row) return 'No fulfillment record';
  if (row.status === 'fulfilled') {
    return row.actualCostCents === null ? 'Fulfilled' : `Fulfilled · ${formatDrawingDollars(row.actualCostCents)}`;
  }
  if (row.status === 'pending') return 'Pending';
  if (row.status === 'ready') return 'Ready';
  if (row.status === 'forfeited') return 'Forfeited';
  return 'No fulfillment record';
}

function eventLabel(status: string): string | null {
  if (status === 'pending') return 'Pending';
  if (status === 'ready') return 'Ready';
  if (status === 'fulfilled') return 'Fulfilled';
  if (status === 'forfeited') return 'Forfeited';
  return null;
}

/**
 * Pure view of one campaign. Counts and the recorded-cost total come from
 * summarizeFulfillment. The full seed and the full member ids are not copied
 * onto the result. A cost above the allowance sets a note and nothing else.
 */
export function summarizeDrawingsAdmin(source: DrawingsAdminSource): DrawingsAdminCampaign | null {
  const allowance = source.campaign.fulfillmentAllowanceCents;
  const committed = committedCents(allowance, source.campaign.prizes);
  if (committed === null || !Number.isSafeInteger(source.campaign.totalBudgetCents)) return null;
  const prizes = [...source.campaign.prizes].sort((left, right) => {
    if (left.position !== right.position) return left.position - right.position;
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  });
  const summary = summarizeFulfillment(
    source.fulfillments.map((row) => ({
      status: row.status,
      prizeId: row.prizeId,
      actualCostCents: row.actualCostCents,
    })),
    prizes.map((prize) => ({ id: prize.id, unitValueCents: prize.unitValueCents })),
  );
  const prizeById = new Map(prizes.map((prize) => [prize.id, prize]));
  const fulfillmentByWinner = new Map<string, DrawingsAdminSource['fulfillments'][number]>();
  for (const row of source.fulfillments) {
    if (!fulfillmentByWinner.has(row.winnerId)) fulfillmentByWinner.set(row.winnerId, row);
  }
  const winners = source.selection
    ? [...source.selection.winners]
        .sort((left, right) => {
          if (left.rank !== right.rank) return left.rank - right.rank;
          if (left.unitIndex !== right.unitIndex) return left.unitIndex - right.unitIndex;
          if (left.id < right.id) return -1;
          if (left.id > right.id) return 1;
          return 0;
        })
        .map((winner) => {
          const prize = prizeById.get(winner.prizeId);
          const fulfillment = fulfillmentByWinner.get(winner.id);
          return {
            rank: winner.rank,
            prizeLabel: prize ? displayPrizeLabel({ label: prize.label }, source.campaign.mode) : 'Unknown prize',
            memberLabel: memberLabel(winner.userId, source.profileIds),
            fulfillmentLabel: fulfillmentLabel(fulfillment),
            fulfillmentId: fulfillment?.id ?? null,
            fulfillmentStatus: fulfillment ? fulfillment.status : null,
            memberDeleted: memberDeleted(winner.userId, source.profileIds),
          };
        })
    : [];
  // drawing_fulfillments.winner_id is the winner row id, not the member id.
  const events = [...source.events]
    .sort((left, right) => {
      const byTime = compareCreatedAt(left.createdAt, right.createdAt);
      if (byTime !== 0) return byTime;
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    })
    .flatMap((event) => {
      const label = eventLabel(event.toStatus);
      if (!label) return [];
      return [{ on: formatChicagoCalendarDate(event.createdAt), label }];
    });
  return {
    id: source.campaign.id,
    quarterKey: source.campaign.quarterKey,
    mode: source.campaign.mode,
    status: source.campaign.status,
    modeLabel: modeLabel(source.campaign.mode),
    statusLabel: statusLabel(source.campaign.status),
    activatedOn: formatChicagoCalendarDate(source.campaign.activatedAt),
    closedOn: formatChicagoCalendarDate(source.campaign.closedAt),
    activatedAtSet: source.campaign.activatedAt !== null,
    closedAtSet: source.campaign.closedAt !== null,
    prizes: prizes.map((prize) => ({
      label: displayPrizeLabel({ label: prize.label }, source.campaign.mode),
      quantity: prize.quantity,
      unitValue: formatDrawingDollars(prize.unitValueCents),
    })),
    budgetLabel: `Committed ${formatDrawingDollars(committed)} of ${formatDrawingDollars(source.campaign.totalBudgetCents)}`,
    selectionId: source.selection && source.selection.id.length > 0 ? source.selection.id : null,
    selection: source.selection
      ? {
          seedPreview: seedPreview(source.selection.seed),
          eligibleEntryCount: source.selection.eligibleEntryCount,
          unfilledUnitCount: source.selection.unfilledUnitCount,
          runBy: source.selection.runBy,
          ranOn: formatChicagoCalendarDate(source.selection.createdAt),
        }
      : null,
    winners,
    recordedCostCents: summary.totalActualCostCents,
    allowanceCents: allowance,
    countsLabel: `Pending ${summary.counts.pending} · Ready ${summary.counts.ready} · Fulfilled ${summary.counts.fulfilled} · Forfeited ${summary.counts.forfeited}`,
    costLabel: `Recorded cost ${formatDrawingDollars(summary.totalActualCostCents)} · Allowance ${formatDrawingDollars(allowance)}`,
    note: summary.totalActualCostCents > allowance ? OVER_ALLOWANCE_NOTE : null,
    events,
  };
}

async function loadSelectionDefault(campaignId: string): Promise<SelectionLoad> {
  const result = await getSelection(campaignId);
  if (!result.ok) return { ok: false, error: result.error === 'not_found' ? 'not_found' : 'unavailable' };
  return {
    ok: true,
    selection: {
      id: result.selection.id,
      seed: result.selection.seed,
      eligibleEntryCount: result.selection.eligibleEntryCount,
      unfilledUnitCount: result.selection.unfilledUnitCount,
      runBy: result.selection.runBy,
      createdAt: result.selection.createdAt,
      winners: result.selection.winners.map((winner) => ({
        id: winner.id,
        rank: winner.rank,
        prizeId: winner.prizeId,
        userId: winner.userId,
        unitIndex: winner.unitIndex,
      })),
    },
  };
}

async function loadFulfillmentsDefault(campaignId: string): Promise<FulfillmentLoad> {
  const result = await listFulfillments(campaignId);
  if (!result.ok) return { ok: false, error: 'unavailable' };
  return {
    ok: true,
    fulfillments: result.fulfillments.map((row) => ({
      id: row.id,
      winnerId: row.winnerId,
      prizeId: row.prizeId,
      status: row.status,
      actualCostCents: row.actualCostCents,
    })),
  };
}

async function readPages(
  client: DrawingsAdminClient,
  table: DrawingsAdminTable,
  columns: string,
  prepare: (filter: DrawingsAdminFilter) => DrawingsAdminFilter,
): Promise<{ ok: true; rows: unknown[] } | { ok: false; error: DbError | null }> {
  const rows: unknown[] = [];
  let from = 0;
  try {
    for (;;) {
      const result = await prepare(client.from(table).select(columns)).range(from, from + DRAWINGS_ADMIN_PAGE_SIZE - 1);
      if (result.error) return { ok: false, error: result.error };
      if (!Array.isArray(result.data)) return { ok: false, error: null };
      rows.push(...result.data);
      if (result.data.length < DRAWINGS_ADMIN_PAGE_SIZE) return { ok: true, rows };
      from += DRAWINGS_ADMIN_PAGE_SIZE;
    }
  } catch {
    return { ok: false, error: null };
  }
}

function relationReason(error: DbError | null): 'not_set_up' | 'unavailable' {
  return drawingRelationMissing(error) ? 'not_set_up' : 'unavailable';
}

async function probeTable(
  client: DrawingsAdminClient,
  table: DrawingsAdminTable,
): Promise<'present' | 'not_set_up' | 'unavailable'> {
  try {
    const result = await client.from(table).select('id').range(0, 0);
    if (!result.error) return 'present';
    if (drawingRelationMissing(result.error)) return 'not_set_up';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

type ParsedCampaign = DrawingsAdminSource['campaign'] extends infer Campaign
  ? Campaign extends { prizes: unknown }
    ? Omit<Campaign, 'prizes'>
    : never
  : never;

function readCampaign(value: unknown): ParsedCampaign | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const quarterKey = readText(row.quarter_key);
  const mode = row.mode === 'sample' || row.mode === 'live' ? row.mode : null;
  const status =
    row.status === 'draft' || row.status === 'active' || row.status === 'closed' ? row.status : null;
  const totalBudgetCents = readNonNegative(row.total_budget_cents);
  const fulfillmentAllowanceCents = readNonNegative(row.fulfillment_allowance_cents);
  const activatedAt = readOptionalTimestamp(row.activated_at);
  const closedAt = readOptionalTimestamp(row.closed_at);
  if (
    !id ||
    !quarterKey ||
    !mode ||
    !status ||
    totalBudgetCents === null ||
    fulfillmentAllowanceCents === null ||
    activatedAt === undefined ||
    closedAt === undefined
  ) {
    return null;
  }
  return {
    id,
    quarterKey,
    mode,
    status,
    totalBudgetCents,
    fulfillmentAllowanceCents,
    activatedAt,
    closedAt,
  };
}

function readPrize(value: unknown): (DrawingsAdminPrizeSource & { campaignId: string }) | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const campaignId = readText(row.campaign_id);
  const label = typeof row.label === 'string' ? row.label : null;
  const quantity = readNonNegative(row.quantity);
  const unitValueCents = readNonNegative(row.unit_value_cents);
  const position = readWhole(row.position);
  if (!id || !campaignId || label === null || quantity === null || unitValueCents === null || position === null) {
    return null;
  }
  return { id, campaignId, label, quantity, unitValueCents, position };
}

function readEvent(value: unknown): DrawingsAdminSource['events'][number] | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const fulfillmentId = readText(row.fulfillment_id);
  const toStatus = readText(row.to_status);
  const createdAt = readText(row.created_at);
  if (!id || !fulfillmentId || !toStatus || !createdAt) return null;
  return { id, fulfillmentId, toStatus, createdAt };
}

function readProfileId(value: unknown): string | null {
  const row = asRecord(value);
  if (!row) return null;
  return readText(row.id);
}

function chunks(values: readonly string[]): string[][] {
  const groups: string[][] = [];
  for (let index = 0; index < values.length; index += IN_CHUNK) {
    groups.push(values.slice(index, index + IN_CHUNK));
  }
  return groups;
}

async function loadDrawingsAdminViewInner(
  options: DrawingsAdminLoaderOptions,
): Promise<DrawingsAdminView> {
  const client = options.client ?? drawingsAdminClient();
  const loadSelection = options.loadSelection ?? loadSelectionDefault;
  const loadFulfillments = options.loadFulfillments ?? loadFulfillmentsDefault;

  const campaignPage = await readPages(client, 'drawing_campaigns', CAMPAIGN_COLUMNS, (filter) =>
    filter.order('quarter_key', { ascending: false }).order('id'),
  );
  if (!campaignPage.ok) return { ok: false, reason: relationReason(campaignPage.error) };
  const campaigns: ParsedCampaign[] = [];
  for (const row of campaignPage.rows) {
    const campaign = readCampaign(row);
    if (!campaign) return { ok: false, reason: 'unavailable' };
    campaigns.push(campaign);
  }
  campaigns.sort((left, right) => {
    if (left.quarterKey !== right.quarterKey) return left.quarterKey < right.quarterKey ? 1 : -1;
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  });
  if (campaigns.length === 0) return { ok: true, campaigns: [] };

  const prizePage = await readPages(client, 'drawing_campaign_prizes', PRIZE_COLUMNS, (filter) =>
    filter.order('campaign_id').order('position').order('id'),
  );
  if (!prizePage.ok) return { ok: false, reason: relationReason(prizePage.error) };
  const knownCampaigns = new Set(campaigns.map((campaign) => campaign.id));
  const prizesByCampaign = new Map<string, DrawingsAdminPrizeSource[]>();
  for (const row of prizePage.rows) {
    const prize = readPrize(row);
    if (!prize) return { ok: false, reason: 'unavailable' };
    if (!knownCampaigns.has(prize.campaignId)) continue;
    const list = prizesByCampaign.get(prize.campaignId) ?? [];
    list.push(prize);
    prizesByCampaign.set(prize.campaignId, list);
  }

  const loaded = await Promise.all(
    campaigns.map(async (campaign) => {
      const [selection, fulfillments] = await Promise.all([
        loadSelection(campaign.id),
        loadFulfillments(campaign.id),
      ]);
      return { campaign, selection, fulfillments };
    }),
  );
  if (loaded.some((row) => !row.selection.ok && row.selection.error === 'unavailable')) {
    const probed = await probeTable(client, 'drawing_selections');
    return { ok: false, reason: probed === 'not_set_up' ? 'not_set_up' : 'unavailable' };
  }
  if (loaded.some((row) => !row.fulfillments.ok)) {
    const probed = await probeTable(client, 'drawing_fulfillments');
    return { ok: false, reason: probed === 'not_set_up' ? 'not_set_up' : 'unavailable' };
  }

  const fulfillmentRows = loaded.flatMap((row) => (row.fulfillments.ok ? row.fulfillments.fulfillments : []));
  const fulfillmentIds = [...new Set(fulfillmentRows.map((row) => row.id))];
  const events: DrawingsAdminSource['events'] = [];
  for (const group of chunks(fulfillmentIds)) {
    const eventPage = await readPages(client, 'drawing_fulfillment_events', EVENT_COLUMNS, (filter) =>
      filter.in('fulfillment_id', group).order('created_at').order('id'),
    );
    if (!eventPage.ok) return { ok: false, reason: relationReason(eventPage.error) };
    for (const row of eventPage.rows) {
      const event = readEvent(row);
      if (!event) return { ok: false, reason: 'unavailable' };
      events.push(event);
    }
  }

  const userIds = [
    ...new Set(
      loaded.flatMap((row) => (row.selection.ok ? row.selection.selection.winners.map((winner) => winner.userId) : [])),
    ),
  ];
  const profileIds = new Set<string>();
  for (const group of chunks(userIds)) {
    const profilePage = await readPages(client, 'user_profiles', 'id', (filter) => filter.in('id', group));
    if (!profilePage.ok) return { ok: false, reason: 'unavailable' };
    for (const row of profilePage.rows) {
      const id = readProfileId(row);
      if (!id) return { ok: false, reason: 'unavailable' };
      profileIds.add(id);
    }
  }

  const view: DrawingsAdminCampaign[] = [];
  for (const row of loaded) {
    const fulfillments = row.fulfillments.ok ? row.fulfillments.fulfillments : [];
    const ids = new Set(fulfillments.map((item) => item.id));
    const summarized = summarizeDrawingsAdmin({
      campaign: {
        ...row.campaign,
        prizes: prizesByCampaign.get(row.campaign.id) ?? [],
      },
      selection: row.selection.ok ? row.selection.selection : null,
      fulfillments,
      events: events.filter((event) => ids.has(event.fulfillmentId)),
      profileIds,
    });
    if (!summarized) return { ok: false, reason: 'unavailable' };
    view.push(summarized);
  }
  return { ok: true, campaigns: view };
}

export async function loadDrawingsAdminView(
  options: DrawingsAdminLoaderOptions = {},
): Promise<DrawingsAdminView> {
  try {
    return await loadDrawingsAdminViewInner(options);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export type FulfillmentBudgetResult =
  | {
      ok: true;
      status: FulfillmentStatus;
      recordedCostCents: number;
      allowanceCents: number;
      /**
       * True when user_profiles has no row for drawing_selection_winners.user_id.
       * The fulfillment stores winner_id, not the member id.
       */
      memberDeleted: boolean;
    }
  | { ok: false; error: 'not_found' | 'unavailable' };

const FULFILLMENT_BUDGET_COLUMNS = 'id, campaign_id, status, winner_id';

const WINNER_USER_COLUMNS = 'id, user_id';

const PROFILE_ID_COLUMNS = 'id';

const ALLOWANCE_COLUMNS = 'id, fulfillment_allowance_cents';

async function readFirst(
  client: DrawingsAdminClient,
  table: DrawingsAdminTable,
  columns: string,
  column: string,
  value: string,
): Promise<{ ok: true; row: unknown | null } | { ok: false; error: DbError | null }> {
  try {
    const result = await client.from(table).select(columns).eq(column, value).range(0, 0);
    if (result.error) return { ok: false, error: result.error };
    if (!Array.isArray(result.data)) return { ok: false, error: null };
    return { ok: true, row: result.data[0] ?? null };
  } catch {
    return { ok: false, error: null };
  }
}

function readBudgetFulfillment(
  value: unknown,
): { id: string; campaignId: string; status: FulfillmentStatus; winnerId: string } | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const campaignId = readText(row.campaign_id);
  const status = readText(row.status);
  const winnerId = readText(row.winner_id);
  if (!id || !campaignId || !winnerId || !status || !isFulfillmentStatus(status)) return null;
  return { id, campaignId, status, winnerId };
}

function readWinnerUserId(value: unknown, winnerId: string): string | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const userId = readText(row.user_id);
  if (!id || id !== winnerId || !userId) return null;
  return userId;
}

function readAllowance(value: unknown): number | null {
  const row = asRecord(value);
  if (!row) return null;
  return readNonNegative(row.fulfillment_allowance_cents);
}

/**
 * Recorded cost, allowance, and whether the winner's user_profiles row
 * still exists. The fulfillment points at drawing_selection_winners.id
 * through winner_id. That row's user_id is compared to user_profiles.id.
 * A missing fulfillment is not_found. A missing winner, a profile read
 * error, or a profile row that cannot be read is unavailable. An empty
 * profile result is a deleted member. This does not write.
 */
export async function loadFulfillmentBudget(
  fulfillmentId: string,
  options: DrawingsAdminLoaderOptions = {},
): Promise<FulfillmentBudgetResult> {
  try {
    const client = options.client ?? drawingsAdminClient();
    const loadFulfillments = options.loadFulfillments ?? loadFulfillmentsDefault;
    const fulfillment = await readFirst(
      client,
      'drawing_fulfillments',
      FULFILLMENT_BUDGET_COLUMNS,
      'id',
      fulfillmentId,
    );
    if (!fulfillment.ok) return { ok: false, error: 'unavailable' };
    const current = fulfillment.row === null ? null : readBudgetFulfillment(fulfillment.row);
    if (fulfillment.row === null) return { ok: false, error: 'not_found' };
    if (!current || current.id !== fulfillmentId) return { ok: false, error: 'unavailable' };

    const winner = await readFirst(client, 'drawing_selection_winners', WINNER_USER_COLUMNS, 'id', current.winnerId);
    if (!winner.ok || winner.row === null) return { ok: false, error: 'unavailable' };
    const userId = readWinnerUserId(winner.row, current.winnerId);
    if (!userId) return { ok: false, error: 'unavailable' };

    const profile = await readFirst(client, 'user_profiles', PROFILE_ID_COLUMNS, 'id', userId);
    if (!profile.ok) return { ok: false, error: 'unavailable' };
    let memberDeleted = false;
    if (profile.row !== null) {
      const profileId = readProfileId(profile.row);
      if (!profileId || profileId !== userId) return { ok: false, error: 'unavailable' };
    } else {
      memberDeleted = true;
    }

    const campaign = await readFirst(
      client,
      'drawing_campaigns',
      ALLOWANCE_COLUMNS,
      'id',
      current.campaignId,
    );
    if (!campaign.ok || campaign.row === null) return { ok: false, error: 'unavailable' };
    const allowanceCents = readAllowance(campaign.row);
    if (allowanceCents === null) return { ok: false, error: 'unavailable' };

    const prizePage = await readPages(client, 'drawing_campaign_prizes', PRIZE_COLUMNS, (filter) =>
      filter.eq('campaign_id', current.campaignId).order('position').order('id'),
    );
    if (!prizePage.ok) return { ok: false, error: 'unavailable' };
    const prizes: DrawingsAdminPrizeSource[] = [];
    for (const row of prizePage.rows) {
      const prize = readPrize(row);
      if (!prize || prize.campaignId !== current.campaignId) return { ok: false, error: 'unavailable' };
      prizes.push(prize);
    }

    const fulfillments = await loadFulfillments(current.campaignId);
    if (!fulfillments.ok) return { ok: false, error: 'unavailable' };
    const summary = summarizeFulfillment(
      fulfillments.fulfillments.map((row) => ({
        status: row.status,
        prizeId: row.prizeId,
        actualCostCents: row.actualCostCents,
      })),
      prizes.map((prize) => ({ id: prize.id, unitValueCents: prize.unitValueCents })),
    );
    return {
      ok: true,
      status: current.status,
      recordedCostCents: summary.totalActualCostCents,
      allowanceCents,
      memberDeleted,
    };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}
