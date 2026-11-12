import 'server-only';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { displayPrizeLabel, SAMPLE_PRIZE_MARKER } from '@/lib/drawings/campaign';
import { formatChicagoReachedDate } from '@/lib/progression/format';
import { chicagoQuarterKey } from '@/lib/progression/quarter';

/**
 * Server-only read model for the member sample-drawing card.
 * The session client identifies the signed-in member. The service-role
 * client then reads drawing rows, and winner rows are limited to that
 * member. The returned view has no member id, rank, entry id, seed,
 * operator label, fulfillment cost, note, or actor. The only fulfillment
 * fact that can reach the view is that this member's own prize was
 * forfeited. This module does not write.
 *
 * `mapMemberSampleDrawing` does not touch the database. Entry counts are
 * the stored `quarter_key` totals from the progression summary. They are
 * not computed again from a timestamp.
 */

/** PostgREST returns at most this many rows unless the read is paged. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

const MISSING_RELATION_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);

export const MEMBER_DRAWING_CAMPAIGN_COLUMNS =
  'id, quarter_key, mode, status, starts_at, ends_at';

export const MEMBER_DRAWING_PRIZE_COLUMNS =
  'id, campaign_id, label, quantity, unit_value_cents, position';

/** Selection id and campaign only. The seed and the operator label stay on the server. */
export const MEMBER_DRAWING_SELECTION_COLUMNS = 'id, campaign_id';

/**
 * `id` matches this member's fulfillment row. `user_id` drops anyone else.
 * Neither is copied onto the view. Rank and entry id are not selected.
 */
export const MEMBER_DRAWING_WINNER_COLUMNS = 'id, campaign_id, prize_id, user_id';

/** Status only, and only for this member's winner ids. */
export const MEMBER_DRAWING_FULFILLMENT_COLUMNS = 'winner_id, status';

export type MemberSampleDrawingPrize = {
  label: string;
  quantity: number;
  sampleValueCents: number;
};

export type MemberSampleDrawing =
  | { kind: 'none' }
  | { kind: 'unavailable' }
  | {
      kind: 'campaign';
      quarterKey: string;
      startsOn: string;
      endsOn: string;
      status: 'active' | 'closed';
      prizes: MemberSampleDrawingPrize[];
      entryCount: number;
      result: 'not_drawn' | 'picked' | 'not_picked' | 'forfeited';
      pickedPrizeLabel?: string;
    };

export type MemberSampleDrawingRows = {
  now: Date | string;
  campaigns: readonly unknown[];
  prizes: readonly unknown[];
  selections: readonly unknown[];
  winners: readonly unknown[];
  /**
   * Fulfillment rows for this member's own winners. Omitted means the
   * card keeps the plain picked line. Extra fields on a row are ignored.
   */
  fulfillments?: readonly unknown[];
  /** Counts already grouped by the stored quarter key. */
  entriesByQuarter: readonly { quarterKey: string; count: number }[];
  memberUserId: string;
};

type ParsedCampaign = {
  id: string;
  quarterKey: string;
  mode: 'sample' | 'live';
  status: 'draft' | 'active' | 'closed';
  startsAt: string;
  endsAt: string;
};

type ParsedPrize = {
  id: string;
  campaignId: string;
  label: string;
  quantity: number;
  unitValueCents: number;
  position: number;
};

type DbError = { code?: string | null; message?: string | null } | null;

type PageResult = { data: unknown; error: DbError };

export type MemberDrawingFilter = {
  eq: (column: string, value: string) => MemberDrawingFilter;
  in: (column: string, values: readonly string[]) => MemberDrawingFilter;
  order: (column: string, options?: { ascending?: boolean }) => MemberDrawingFilter;
  range: (from: number, to: number) => Promise<PageResult>;
};

export type MemberDrawingTable =
  | 'drawing_campaigns'
  | 'drawing_campaign_prizes'
  | 'drawing_selections'
  | 'drawing_selection_winners'
  | 'drawing_fulfillments';

export type MemberDrawingClient = {
  from: (table: MemberDrawingTable) => {
    select: (columns: string) => MemberDrawingFilter;
  };
};

export type MemberDrawingSession = {
  auth: {
    getUser: () => PromiseLike<{
      data: { user: { id: string } | null };
      error: { message?: string } | null;
    }>;
  };
};

export type LoadMemberSampleDrawingInput = {
  userId: string;
  now: Date;
  entriesByQuarter: readonly { quarterKey: string; count: number }[];
  session: MemberDrawingSession;
  admin?: MemberDrawingClient;
};

function memberDrawingAdmin(): MemberDrawingClient {
  return getSupabaseAdmin() as unknown as MemberDrawingClient;
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

function readTimestamp(value: unknown): string | null {
  const text = readText(value);
  if (!text || Number.isNaN(Date.parse(text))) return null;
  return text;
}

/**
 * Same missing-relation signals as the admin drawings reader.
 * A partial drawing schema is a failed read, not an empty campaign.
 */
function relationMissing(error: DbError): boolean {
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

function parseCampaign(value: unknown): ParsedCampaign | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const quarterKey = readText(row.quarter_key);
  const mode = row.mode === 'sample' || row.mode === 'live' ? row.mode : null;
  const status =
    row.status === 'draft' || row.status === 'active' || row.status === 'closed' ? row.status : null;
  const startsAt = readTimestamp(row.starts_at);
  const endsAt = readTimestamp(row.ends_at);
  if (!id || !quarterKey || !mode || !status || !startsAt || !endsAt) return null;
  return { id, quarterKey, mode, status, startsAt, endsAt };
}

function parsePrize(value: unknown): ParsedPrize | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const campaignId = readText(row.campaign_id);
  const label = typeof row.label === 'string' ? row.label : null;
  const quantity = readNonNegative(row.quantity);
  const unitValueCents = readNonNegative(row.unit_value_cents);
  const position = readWhole(row.position);
  if (!id || !campaignId || label === null || quantity === null || quantity < 1) return null;
  if (unitValueCents === null || position === null || position < 0) return null;
  return { id, campaignId, label, quantity, unitValueCents, position };
}

function parseSelection(value: unknown): { campaignId: string } | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const campaignId = readText(row.campaign_id);
  if (!id || !campaignId) return null;
  return { campaignId };
}

function parseWinner(
  value: unknown,
): { id: string | null; campaignId: string; prizeId: string; userId: string } | null {
  const row = asRecord(value);
  if (!row) return null;
  const campaignId = readText(row.campaign_id);
  const prizeId = readText(row.prize_id);
  const userId = readText(row.user_id);
  if (!campaignId || !prizeId || !userId) return null;
  return { id: readText(row.id), campaignId, prizeId, userId };
}

/** Winner ids whose own fulfillment status is exactly forfeited. Other fields are ignored. */
function forfeitedWinnerIds(rows: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const value of rows) {
    const row = asRecord(value);
    if (!row) continue;
    const winnerId = readText(row.winner_id);
    if (!winnerId || row.status !== 'forfeited') continue;
    ids.add(winnerId);
  }
  return ids;
}

function visibleCampaigns(campaigns: readonly ParsedCampaign[], quarterKey: string): ParsedCampaign[] {
  return campaigns
    .filter(
      (campaign) =>
        campaign.quarterKey === quarterKey &&
        campaign.mode === 'sample' &&
        (campaign.status === 'active' || campaign.status === 'closed'),
    )
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === 'active' ? -1 : 1;
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    });
}

/**
 * Inclusive Chicago calendar day of the stored exclusive `ends_at`.
 * One millisecond before that instant is the last moment of the quarter,
 * which is how the admin editor shows 2027-Q1 as through Mar 31, 2027.
 */
function inclusiveChicagoEnd(endsAt: string): string | null {
  const ms = Date.parse(endsAt);
  if (!Number.isFinite(ms)) return null;
  return formatChicagoReachedDate(new Date(ms - 1).toISOString());
}

function entryCountFor(
  quarterKey: string,
  entriesByQuarter: readonly { quarterKey: string; count: number }[],
): number {
  let total = 0;
  for (const row of entriesByQuarter) {
    if (!row || row.quarterKey !== quarterKey) continue;
    if (typeof row.count !== 'number' || !Number.isSafeInteger(row.count) || row.count < 0) continue;
    total += row.count;
  }
  return total;
}

/**
 * Picks the current Chicago quarter's sample campaign and this member's result.
 * An active sample campaign wins over a closed one. Draft and live rows are
 * not shown. A selection row decides picked, not picked, or not drawn.
 * A forfeited status on this member's own winner replaces the picked line.
 * Any other status, or no fulfillment row, stays on the picked line.
 */
export function mapMemberSampleDrawing(input: MemberSampleDrawingRows): MemberSampleDrawing {
  let quarterKey: string;
  try {
    const instant = input.now instanceof Date ? input.now : new Date(input.now);
    if (Number.isNaN(instant.getTime())) return { kind: 'unavailable' };
    quarterKey = chicagoQuarterKey(instant.toISOString());
  } catch {
    return { kind: 'unavailable' };
  }

  const campaigns: ParsedCampaign[] = [];
  for (const row of input.campaigns) {
    const campaign = parseCampaign(row);
    if (!campaign) return { kind: 'unavailable' };
    campaigns.push(campaign);
  }
  const visible = visibleCampaigns(campaigns, quarterKey);
  const chosen = visible[0];
  if (!chosen) return { kind: 'none' };

  const prizes: ParsedPrize[] = [];
  for (const row of input.prizes) {
    const prize = parsePrize(row);
    if (!prize) return { kind: 'unavailable' };
    if (prize.campaignId !== chosen.id) continue;
    prizes.push(prize);
  }
  prizes.sort((left, right) => {
    if (left.position !== right.position) return left.position - right.position;
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  });

  const selections: { campaignId: string }[] = [];
  for (const row of input.selections) {
    const selection = parseSelection(row);
    if (!selection) return { kind: 'unavailable' };
    selections.push(selection);
  }

  const ownWinners: { id: string | null; prizeId: string }[] = [];
  for (const row of input.winners) {
    const winner = parseWinner(row);
    if (!winner) return { kind: 'unavailable' };
    if (winner.userId !== input.memberUserId || winner.campaignId !== chosen.id) continue;
    ownWinners.push({ id: winner.id, prizeId: winner.prizeId });
  }

  const startsOn = formatChicagoReachedDate(chosen.startsAt);
  const endsOn = inclusiveChicagoEnd(chosen.endsAt);
  if (!startsOn || !endsOn) return { kind: 'unavailable' };

  const drawn = selections.some((selection) => selection.campaignId === chosen.id);
  let result: 'not_drawn' | 'picked' | 'not_picked' | 'forfeited' = 'not_drawn';
  let pickedPrizeLabel: string | undefined;
  if (drawn) {
    if (ownWinners.length === 0) {
      result = 'not_picked';
    } else {
      const forfeitedIds = forfeitedWinnerIds(input.fulfillments ?? []);
      const forfeited = ownWinners.find((winner) => winner.id !== null && forfeitedIds.has(winner.id));
      const source = forfeited ?? ownWinners[0];
      result = forfeited ? 'forfeited' : 'picked';
      const won = prizes.find((prize) => prize.id === source.prizeId);
      pickedPrizeLabel = won ? displayPrizeLabel({ label: won.label }, 'sample') : SAMPLE_PRIZE_MARKER;
    }
  }

  return {
    kind: 'campaign',
    quarterKey: chosen.quarterKey,
    startsOn,
    endsOn,
    status: chosen.status === 'closed' ? 'closed' : 'active',
    prizes: prizes.map((prize) => ({
      label: displayPrizeLabel({ label: prize.label }, 'sample'),
      quantity: prize.quantity,
      sampleValueCents: prize.unitValueCents,
    })),
    entryCount: entryCountFor(quarterKey, input.entriesByQuarter),
    result,
    ...(pickedPrizeLabel ? { pickedPrizeLabel } : {}),
  };
}

async function readSessionUserId(session: MemberDrawingSession): Promise<string | null | 'unavailable'> {
  try {
    const { data } = await session.auth.getUser();
    const id = data.user?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return 'unavailable';
  }
}

async function readPages(
  client: MemberDrawingClient,
  table: MemberDrawingTable,
  columns: string,
  prepare: (filter: MemberDrawingFilter) => MemberDrawingFilter,
): Promise<{ ok: true; rows: unknown[] } | { ok: false; missing: boolean }> {
  const rows: unknown[] = [];
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_SIZE;
      const result = await prepare(client.from(table).select(columns)).range(from, from + PAGE_SIZE - 1);
      if (result.error || !Array.isArray(result.data)) {
        // A missing drawing table and any other read failure are the same
        // member-facing result. The error text is not logged.
        return { ok: false, missing: relationMissing(result.error) };
      }
      rows.push(...result.data);
      if (result.data.length < PAGE_SIZE) return { ok: true, rows };
    }
  } catch {
    return { ok: false, missing: false };
  }
  return { ok: false, missing: false };
}

/**
 * Session user first. No session, or a different id than `userId`, returns
 * `none` and does not call the service-role client. A missing table or a
 * thrown read returns `unavailable` and is not logged.
 */
export async function loadMemberSampleDrawing(
  input: LoadMemberSampleDrawingInput,
): Promise<MemberSampleDrawing> {
  const sessionUserId = await readSessionUserId(input.session);
  if (sessionUserId === 'unavailable') return { kind: 'unavailable' };
  if (sessionUserId === null || sessionUserId !== input.userId) return { kind: 'none' };

  try {
    const admin = input.admin ?? memberDrawingAdmin();
    let quarterKey: string;
    try {
      quarterKey = chicagoQuarterKey(input.now.toISOString());
    } catch {
      return { kind: 'unavailable' };
    }

    const campaignPage = await readPages(admin, 'drawing_campaigns', MEMBER_DRAWING_CAMPAIGN_COLUMNS, (filter) =>
      filter.eq('quarter_key', quarterKey).order('id'),
    );
    if (!campaignPage.ok) return { kind: 'unavailable' };

    const parsed: ParsedCampaign[] = [];
    for (const row of campaignPage.rows) {
      const campaign = parseCampaign(row);
      if (!campaign) return { kind: 'unavailable' };
      parsed.push(campaign);
    }
    const visible = visibleCampaigns(parsed, quarterKey);
    if (visible.length === 0) return { kind: 'none' };
    const ids = visible.map((campaign) => campaign.id);

    const [prizePage, selectionPage, winnerPage] = await Promise.all([
      readPages(admin, 'drawing_campaign_prizes', MEMBER_DRAWING_PRIZE_COLUMNS, (filter) =>
        filter.in('campaign_id', ids).order('position').order('id'),
      ),
      readPages(admin, 'drawing_selections', MEMBER_DRAWING_SELECTION_COLUMNS, (filter) =>
        filter.in('campaign_id', ids),
      ),
      readPages(admin, 'drawing_selection_winners', MEMBER_DRAWING_WINNER_COLUMNS, (filter) =>
        filter.eq('user_id', sessionUserId).in('campaign_id', ids),
      ),
    ]);
    if (!prizePage.ok || !selectionPage.ok || !winnerPage.ok) return { kind: 'unavailable' };

    const ownWinnerIds: string[] = [];
    for (const row of winnerPage.rows) {
      const winner = parseWinner(row);
      if (!winner) return { kind: 'unavailable' };
      if (winner.userId === sessionUserId && winner.id) ownWinnerIds.push(winner.id);
    }

    // A failed fulfillment read keeps today's picked line. It does not
    // take the card down, and the error text is not logged.
    const fulfillmentRows: unknown[] = [];
    if (ownWinnerIds.length > 0) {
      const fulfillmentPage = await readPages(
        admin,
        'drawing_fulfillments',
        MEMBER_DRAWING_FULFILLMENT_COLUMNS,
        (filter) => filter.in('winner_id', ownWinnerIds),
      );
      if (fulfillmentPage.ok) {
        for (const row of fulfillmentPage.rows) {
          const record = asRecord(row);
          if (!record) continue;
          const winnerId = readText(record.winner_id);
          const status = readText(record.status);
          if (!winnerId || !status) continue;
          fulfillmentRows.push({ winner_id: winnerId, status });
        }
      }
    }

    return mapMemberSampleDrawing({
      now: input.now,
      campaigns: campaignPage.rows,
      prizes: prizePage.rows,
      selections: selectionPage.rows,
      winners: winnerPage.rows,
      fulfillments: fulfillmentRows,
      entriesByQuarter: input.entriesByQuarter,
      memberUserId: sessionUserId,
    });
  } catch {
    return { kind: 'unavailable' };
  }
}
