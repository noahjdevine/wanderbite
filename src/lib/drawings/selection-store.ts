import 'server-only';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  DRAWING_SELECTION_ALGORITHM,
  SELECTION_ERROR_CODES,
  checkSelectionAllowed,
  compareRanked,
  entryRankHex,
  explainSelectionMatch,
  filterEligibleEntries,
  isBlankRunBy,
  selectWinners,
  type EligibleEntry,
  type SelectedWinner,
  type SelectionErrorCode,
  type SelectionPrize,
} from '@/lib/drawings/selection';

/**
 * Server-only reader and caller for simulated winner selection.
 * runSimulatedSelection checks the campaign, then calls
 * select_drawing_winners. verifySelection replays the stored seed and
 * the stored entry pool, then reports whether the entries eligible now
 * still match that pool. The admin drawings page calls getSelection.
 * Admin drawing actions call runSimulatedSelection when their flag is on.
 * verifySelection has no app caller. The tables are not in
 * database.types.ts. No member is notified.
 */

/** PostgREST returns at most this many rows unless the read is paged. */
export const ENTRY_PAGE_SIZE = 1000;

/** Milestone id lists stay short enough for one request URL. */
export const MILESTONE_IN_CHUNK = 200;

export type StoredSelectionWinner = SelectedWinner & {
  id: string;
  selectionId: string;
  campaignId: string;
  createdAt: string;
};

export type StoredSelection = {
  id: string;
  campaignId: string;
  algorithmVersion: string;
  seed: string;
  eligibleEntryCount: number;
  eligibleMemberCount: number;
  /** Eligible entry ids in sha256-rank order. Column eligible_entry_ids. */
  eligibleEntryIds: string[];
  /** user_id of each eligibleEntryIds element, same order. Column eligible_user_ids. */
  eligibleUserIds: string[];
  prizeUnitCount: number;
  unfilledUnitCount: number;
  simulated: true;
  runBy: string;
  createdAt: string;
  winners: StoredSelectionWinner[];
};

export type SelectionStoreError = SelectionErrorCode | 'unavailable';

export type RunSelectionResult =
  | { ok: true; selection: StoredSelection }
  | { ok: false; error: SelectionStoreError };

export type ReadSelectionResult =
  | { ok: true; selection: StoredSelection }
  | { ok: false; error: 'not_found' | 'unavailable' };

export type VerifySelectionResult =
  | { ok: true; match: true; drift: boolean; selectionId: string }
  | { ok: true; match: false; drift: boolean; selectionId: string; reason: string }
  | { ok: false; error: 'not_found' | 'unavailable' };

type DbError = { message?: string; code?: string };

type RowPage = { data: unknown; error: DbError | null };

type OrderedPage = PromiseLike<RowPage> & {
  range: (from: number, to: number) => PromiseLike<RowPage>;
};

type EqBuilder = {
  maybeSingle: () => PromiseLike<RowPage>;
  order: (column: string) => OrderedPage;
};

export type SelectionQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => EqBuilder;
    in: (column: string, values: readonly string[]) => PromiseLike<RowPage>;
  };
};

export type SelectionTable =
  | 'drawing_campaigns'
  | 'drawing_campaign_prizes'
  | 'drawing_selections'
  | 'drawing_selection_winners'
  | 'progression_drawing_entries'
  | 'progression_milestones';

export type SelectionStoreClient = {
  rpc: (
    fn: 'select_drawing_winners',
    args: { p_campaign_id: string; p_run_by: string },
  ) => PromiseLike<{ data: unknown; error: DbError | null }>;
  from: (table: SelectionTable) => SelectionQuery;
};

const CAMPAIGN_COLUMNS =
  'id, status, mode, quarter_key, eligible_entry_sources, activated_at, closed_at';

const PRIZE_COLUMNS = 'id, campaign_id, position, quantity';

const SELECTION_COLUMNS =
  'id, campaign_id, algorithm_version, seed, eligible_entry_count, eligible_member_count, eligible_entry_ids, eligible_user_ids, prize_unit_count, unfilled_unit_count, simulated, run_by, created_at';

const WINNER_COLUMNS =
  'id, selection_id, campaign_id, prize_id, unit_index, entry_id, user_id, rank, created_at';

const ENTRY_COLUMNS = 'id, user_id, quarter_key, entry_source, milestone_id';

const MILESTONE_COLUMNS = 'id, reached_at';

function selectionStoreClient(): SelectionStoreClient {
  return getSupabaseAdmin() as unknown as SelectionStoreClient;
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
  if (typeof value === 'string' && /^-?\d+(\.0+)?$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function readUuidList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    const id = readText(item);
    if (!id) return null;
    ids.push(id);
  }
  return ids;
}

function messageHasCode(message: string, code: string): boolean {
  return message === code || new RegExp(`\\b${code}\\b`).test(message);
}

function failureFromDb(error: DbError): RunSelectionResult {
  const message = error.message ?? '';
  if (error.code === 'P0002' || messageHasCode(message, 'not_found')) {
    return { ok: false, error: 'not_found' };
  }
  for (const code of SELECTION_ERROR_CODES) {
    if (messageHasCode(message, code)) return { ok: false, error: code };
  }
  return { ok: false, error: 'unavailable' };
}

type CampaignGateRow = {
  id: string;
  status: string;
  mode: string;
  quarterKey: string;
  eligibleEntrySources: string[];
  activatedAt: string | null;
  closedAt: string | null;
};

function readCampaign(value: unknown): CampaignGateRow | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const status = readText(row.status);
  const mode = readText(row.mode);
  const quarterKey = readText(row.quarter_key);
  const sources = row.eligible_entry_sources;
  if (!id || !status || !mode || !quarterKey) return null;
  if (!Array.isArray(sources) || sources.some((source) => typeof source !== 'string')) return null;
  const activatedAt = row.activated_at === null ? null : readText(row.activated_at);
  const closedAt = row.closed_at === null ? null : readText(row.closed_at);
  if (row.activated_at !== null && activatedAt === null) return null;
  if (row.closed_at !== null && closedAt === null) return null;
  return {
    id,
    status,
    mode,
    quarterKey,
    eligibleEntrySources: sources as string[],
    activatedAt,
    closedAt,
  };
}

function readPrize(value: unknown, campaignId: string): SelectionPrize | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const position = readWhole(row.position);
  const quantity = readWhole(row.quantity);
  if (!id || position === null || quantity === null) return null;
  if (readText(row.campaign_id) !== campaignId) return null;
  return { id, position, quantity };
}

function readWinner(value: unknown, selectionId: string): StoredSelectionWinner | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const campaignId = readText(row.campaign_id);
  const prizeId = readText(row.prize_id);
  const entryId = readText(row.entry_id);
  const userId = readText(row.user_id);
  const createdAt = readText(row.created_at);
  const unitIndex = readWhole(row.unit_index);
  const rank = readWhole(row.rank);
  if (
    !id ||
    !campaignId ||
    !prizeId ||
    !entryId ||
    !userId ||
    !createdAt ||
    unitIndex === null ||
    rank === null ||
    readText(row.selection_id) !== selectionId
  ) {
    return null;
  }
  return { id, selectionId, campaignId, prizeId, unitIndex, entryId, userId, rank, createdAt };
}

function readSelection(value: unknown, winnersValue: unknown): StoredSelection | null {
  const row = asRecord(value);
  if (!row || !Array.isArray(winnersValue)) return null;
  const id = readText(row.id);
  const campaignId = readText(row.campaign_id);
  const algorithmVersion = readText(row.algorithm_version);
  const seed = readText(row.seed);
  const runBy = readText(row.run_by);
  const createdAt = readText(row.created_at);
  const eligibleEntryCount = readWhole(row.eligible_entry_count);
  const eligibleMemberCount = readWhole(row.eligible_member_count);
  const eligibleEntryIds = readUuidList(row.eligible_entry_ids);
  const eligibleUserIds = readUuidList(row.eligible_user_ids);
  const prizeUnitCount = readWhole(row.prize_unit_count);
  const unfilledUnitCount = readWhole(row.unfilled_unit_count);
  if (
    !id ||
    !campaignId ||
    !algorithmVersion ||
    !seed ||
    !runBy ||
    !createdAt ||
    eligibleEntryCount === null ||
    eligibleMemberCount === null ||
    !eligibleEntryIds ||
    !eligibleUserIds ||
    prizeUnitCount === null ||
    unfilledUnitCount === null ||
    row.simulated !== true
  ) {
    return null;
  }
  const winners: StoredSelectionWinner[] = [];
  for (const winner of winnersValue) {
    const stored = readWinner(winner, id);
    if (!stored || stored.campaignId !== campaignId) return null;
    winners.push(stored);
  }
  winners.sort((left, right) => left.rank - right.rank);
  return {
    id,
    campaignId,
    algorithmVersion,
    seed,
    eligibleEntryCount,
    eligibleMemberCount,
    eligibleEntryIds,
    eligibleUserIds,
    prizeUnitCount,
    unfilledUnitCount,
    simulated: true,
    runBy,
    createdAt,
    winners,
  };
}

async function maybeOne(query: PromiseLike<RowPage>): Promise<unknown | 'unavailable'> {
  try {
    const result = await query;
    if (result.error) return 'unavailable';
    return result.data;
  } catch {
    return 'unavailable';
  }
}

async function many(query: PromiseLike<RowPage>): Promise<unknown[] | 'unavailable'> {
  const data = await maybeOne(query);
  if (data === 'unavailable') return 'unavailable';
  if (!Array.isArray(data)) return 'unavailable';
  return data;
}

async function loadCampaign(
  client: SelectionStoreClient,
  campaignId: string,
): Promise<CampaignGateRow | 'not_found' | 'unavailable'> {
  const data = await maybeOne(
    client.from('drawing_campaigns').select(CAMPAIGN_COLUMNS).eq('id', campaignId).maybeSingle(),
  );
  if (data === 'unavailable') return 'unavailable';
  if (data === null) return 'not_found';
  const campaign = readCampaign(data);
  if (!campaign || campaign.id !== campaignId) return 'unavailable';
  return campaign;
}

async function loadSelectionRow(
  client: SelectionStoreClient,
  campaignId: string,
): Promise<Record<string, unknown> | null | 'unavailable'> {
  const data = await maybeOne(
    client.from('drawing_selections').select(SELECTION_COLUMNS).eq('campaign_id', campaignId).maybeSingle(),
  );
  if (data === 'unavailable') return 'unavailable';
  if (data === null) return null;
  const row = asRecord(data);
  return row ?? 'unavailable';
}

async function loadWinners(
  client: SelectionStoreClient,
  selectionId: string,
): Promise<unknown[] | 'unavailable'> {
  return many(
    client.from('drawing_selection_winners').select(WINNER_COLUMNS).eq('selection_id', selectionId).order('rank'),
  );
}

async function loadPrizes(
  client: SelectionStoreClient,
  campaignId: string,
): Promise<SelectionPrize[] | 'unavailable'> {
  const rows = await many(
    client.from('drawing_campaign_prizes').select(PRIZE_COLUMNS).eq('campaign_id', campaignId).order('position'),
  );
  if (rows === 'unavailable') return 'unavailable';
  const prizes: SelectionPrize[] = [];
  for (const row of rows) {
    const prize = readPrize(row, campaignId);
    if (!prize) return 'unavailable';
    prizes.push(prize);
  }
  return prizes;
}

async function loadEntryPages(
  client: SelectionStoreClient,
  quarterKey: string,
): Promise<unknown[] | 'unavailable'> {
  const rows: unknown[] = [];
  let from = 0;
  for (;;) {
    const page = await many(
      client
        .from('progression_drawing_entries')
        .select(ENTRY_COLUMNS)
        .eq('quarter_key', quarterKey)
        .order('id')
        .range(from, from + ENTRY_PAGE_SIZE - 1),
    );
    if (page === 'unavailable') return 'unavailable';
    rows.push(...page);
    if (page.length < ENTRY_PAGE_SIZE) return rows;
    from += ENTRY_PAGE_SIZE;
  }
}

async function loadMilestones(
  client: SelectionStoreClient,
  milestoneIds: readonly string[],
): Promise<Map<string, string> | 'unavailable'> {
  const reached = new Map<string, string>();
  for (let index = 0; index < milestoneIds.length; index += MILESTONE_IN_CHUNK) {
    const chunk = milestoneIds.slice(index, index + MILESTONE_IN_CHUNK);
    const milestoneRows = await many(
      client.from('progression_milestones').select(MILESTONE_COLUMNS).in('id', chunk),
    );
    if (milestoneRows === 'unavailable') return 'unavailable';
    for (const value of milestoneRows) {
      const row = asRecord(value);
      const id = row ? readText(row.id) : null;
      const at = row ? readText(row.reached_at) : null;
      if (!id || !at) return 'unavailable';
      reached.set(id, at);
    }
  }
  return reached;
}

async function loadEligible(
  client: SelectionStoreClient,
  campaign: CampaignGateRow,
): Promise<EligibleEntry[] | 'unavailable'> {
  if (campaign.closedAt === null) return [];
  const entryRows = await loadEntryPages(client, campaign.quarterKey);
  if (entryRows === 'unavailable') return 'unavailable';
  const milestoneIds: string[] = [];
  const parsed: {
    id: string;
    userId: string;
    quarterKey: string;
    entrySource: string;
    milestoneId: string;
  }[] = [];
  for (const value of entryRows) {
    const row = asRecord(value);
    if (!row) return 'unavailable';
    const id = readText(row.id);
    const userId = readText(row.user_id);
    const quarterKey = readText(row.quarter_key);
    const entrySource = readText(row.entry_source);
    const milestoneId = readText(row.milestone_id);
    if (!id || !userId || !quarterKey || !entrySource || !milestoneId) return 'unavailable';
    parsed.push({ id, userId, quarterKey, entrySource, milestoneId });
    milestoneIds.push(milestoneId);
  }
  const reached = await loadMilestones(client, milestoneIds);
  if (reached === 'unavailable') return 'unavailable';
  const entries: EligibleEntry[] = [];
  for (const entry of parsed) {
    const reachedAt = reached.get(entry.milestoneId);
    if (!reachedAt) continue;
    entries.push({
      id: entry.id,
      userId: entry.userId,
      quarterKey: entry.quarterKey,
      entrySource: entry.entrySource,
      reachedAt,
    });
  }
  return filterEligibleEntries(entries, {
    quarterKey: campaign.quarterKey,
    eligibleEntrySources: campaign.eligibleEntrySources,
    closedAt: campaign.closedAt,
  });
}

/**
 * Reads the draw for one campaign, including its winner rows.
 * No row is not_found.
 */
export async function getSelection(
  campaignId: string,
  client: SelectionStoreClient = selectionStoreClient(),
): Promise<ReadSelectionResult> {
  try {
    const row = await loadSelectionRow(client, campaignId);
    if (row === 'unavailable') return { ok: false, error: 'unavailable' };
    if (row === null) return { ok: false, error: 'not_found' };
    const selectionId = readText(row.id);
    if (!selectionId) return { ok: false, error: 'unavailable' };
    const winners = await loadWinners(client, selectionId);
    if (winners === 'unavailable') return { ok: false, error: 'unavailable' };
    const selection = readSelection(row, winners);
    if (!selection || selection.campaignId !== campaignId) return { ok: false, error: 'unavailable' };
    return { ok: true, selection };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

/**
 * Runs the pure gate, then select_drawing_winners. A rejected campaign
 * does not call the database function. The function repeats the gate and
 * is the only writer. A blank operator label is invalid_run_by, after the
 * campaign-state codes, matching the function.
 */
export async function runSimulatedSelection(
  campaignId: string,
  runBy: string,
  client: SelectionStoreClient = selectionStoreClient(),
): Promise<RunSelectionResult> {
  const campaign = await loadCampaign(client, campaignId);
  if (campaign === 'not_found' || campaign === 'unavailable') return { ok: false, error: campaign };
  const existing = await loadSelectionRow(client, campaignId);
  if (existing === 'unavailable') return { ok: false, error: 'unavailable' };
  const existingId = existing ? readText(existing.id) : null;
  const gate = checkSelectionAllowed(
    {
      status: campaign.status,
      mode: campaign.mode,
      activatedAt: campaign.activatedAt,
      closedAt: campaign.closedAt,
    },
    existingId ? { id: existingId } : null,
  );
  if (!gate.ok) return gate;
  if (isBlankRunBy(runBy)) return { ok: false, error: 'invalid_run_by' };
  let result: { data: unknown; error: DbError | null };
  try {
    result = await client.rpc('select_drawing_winners', {
      p_campaign_id: campaignId,
      p_run_by: runBy,
    });
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  if (result.error) return failureFromDb(result.error);
  const payload = asRecord(result.data);
  if (!payload) return { ok: false, error: 'unavailable' };
  const selection = readSelection(payload.selection, payload.winners);
  if (!selection || selection.campaignId !== campaignId) return { ok: false, error: 'unavailable' };
  return { ok: true, selection };
}

function replayStoredPool(
  selection: StoredSelection,
  prizes: SelectionPrize[],
): { match: true } | { match: false; reason: string } {
  if (
    selection.eligibleEntryIds.length !== selection.eligibleEntryCount ||
    selection.eligibleUserIds.length !== selection.eligibleEntryIds.length
  ) {
    return { match: false, reason: 'eligible_pool' };
  }
  const recomputed = selectWinners({
    seed: selection.seed,
    entries: selection.eligibleEntryIds.map((id, index) => ({
      id,
      userId: selection.eligibleUserIds[index],
    })),
    prizes,
    algorithmVersion: selection.algorithmVersion || DRAWING_SELECTION_ALGORITHM,
  });
  if (!recomputed.ok) return { match: false, reason: recomputed.error };
  return explainSelectionMatch(selection, recomputed);
}

function poolDrifted(selection: StoredSelection, current: readonly EligibleEntry[]): boolean {
  const ordered = [...current].sort((left, right) =>
    compareRanked(
      { rankKey: entryRankHex(selection.seed, left.id), id: left.id },
      { rankKey: entryRankHex(selection.seed, right.id), id: right.id },
    ),
  );
  if (ordered.length !== selection.eligibleEntryIds.length) return true;
  return ordered.some(
    (entry, index) =>
      entry.id !== selection.eligibleEntryIds[index] || entry.userId !== selection.eligibleUserIds[index],
  );
}

/**
 * match is whether the stored seed and the stored entry pool reproduce the
 * stored winners. drift is whether the entries eligible now differ from
 * that pool. Drift does not change match. The stored rows are not changed.
 * A draw that is not there is not_found.
 */
export async function verifySelection(
  campaignId: string,
  client: SelectionStoreClient = selectionStoreClient(),
): Promise<VerifySelectionResult> {
  const stored = await getSelection(campaignId, client);
  if (!stored.ok) return stored;
  const campaign = await loadCampaign(client, campaignId);
  if (campaign === 'unavailable') return { ok: false, error: 'unavailable' };
  const prizes = campaign === 'not_found' ? null : await loadPrizes(client, campaignId);
  if (prizes === 'unavailable') return { ok: false, error: 'unavailable' };
  const replay =
    campaign === 'not_found' || prizes === null
      ? { match: false as const, reason: 'campaign' }
      : replayStoredPool(stored.selection, prizes);
  let drift = true;
  if (campaign !== 'not_found' && campaign.closedAt !== null) {
    const current = await loadEligible(client, campaign);
    if (current === 'unavailable') return { ok: false, error: 'unavailable' };
    drift = poolDrifted(stored.selection, current);
  }
  if (!replay.match) {
    return {
      ok: true,
      match: false,
      drift,
      selectionId: stored.selection.id,
      reason: replay.reason,
    };
  }
  return { ok: true, match: true, drift, selectionId: stored.selection.id };
}
