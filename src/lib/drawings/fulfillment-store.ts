import 'server-only';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  FULFILLMENT_ERROR_CODES,
  checkFulfillmentTransition,
  compareCreatedAt,
  isBlankOperator,
  isFulfillmentStatus,
  type FulfillmentErrorCode,
  type FulfillmentStatus,
} from '@/lib/drawings/fulfillment';

/**
 * Server-only reader and caller for simulated fulfillment records.
 * createFulfillments and transitionFulfillment run the pure checks,
 * then the matching RPC. listFulfillments reads one campaign in pages
 * of 1000 and orders the loaded rows by created_at instant, then id.
 * Nothing in the app calls this module. The tables are not in
 * database.types.ts. No member is notified.
 */

/** PostgREST returns at most this many rows unless the read is paged. */
export const FULFILLMENT_PAGE_SIZE = 1000;

export type StoredFulfillment = {
  id: string;
  winnerId: string;
  selectionId: string;
  campaignId: string;
  prizeId: string;
  status: FulfillmentStatus;
  simulated: true;
  actualCostCents: number | null;
  createdAt: string;
  updatedAt: string;
};

export type FulfillmentStoreError = FulfillmentErrorCode | 'unavailable';

export type CreateFulfillmentsResult =
  | { ok: true; fulfillments: StoredFulfillment[] }
  | { ok: false; error: 'not_found' | 'invalid_run_by' | 'unavailable' };

export type TransitionFulfillmentResult =
  | { ok: true; fulfillment: StoredFulfillment }
  | {
      ok: false;
      error:
        | 'not_found'
        | 'invalid_actor'
        | 'invalid_transition'
        | 'cost_required'
        | 'cost_not_allowed'
        | 'drawing_fulfillments_actual_cost_cents_check'
        | 'drawing_fulfillment_events_note_check'
        | 'unavailable';
    };

export type ListFulfillmentsResult =
  | { ok: true; fulfillments: StoredFulfillment[] }
  | { ok: false; error: 'unavailable' };

type DbError = { message?: string; code?: string };

type RowPage = { data: unknown; error: DbError | null };

type OrderedPage = PromiseLike<RowPage> & {
  order: (column: string) => OrderedPage;
  range: (from: number, to: number) => PromiseLike<RowPage>;
};

type EqBuilder = {
  maybeSingle: () => PromiseLike<RowPage>;
  order: (column: string) => OrderedPage;
};

export type FulfillmentQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => EqBuilder;
  };
};

export type FulfillmentTable = 'drawing_selections' | 'drawing_fulfillments';

export type CreateFulfillmentArgs = {
  p_selection_id: string;
  p_run_by: string;
};

export type TransitionFulfillmentArgs = {
  p_fulfillment_id: string;
  p_to_status: string;
  p_actor: string;
  p_note: string | null;
  p_actual_cost_cents: number | null;
};

export type FulfillmentStoreClient = {
  rpc: {
    (
      fn: 'create_drawing_fulfillments',
      args: CreateFulfillmentArgs,
    ): PromiseLike<{ data: unknown; error: DbError | null }>;
    (
      fn: 'transition_drawing_fulfillment',
      args: TransitionFulfillmentArgs,
    ): PromiseLike<{ data: unknown; error: DbError | null }>;
  };
  from: (table: FulfillmentTable) => FulfillmentQuery;
};

const SELECTION_COLUMNS = 'id, simulated';

const FULFILLMENT_COLUMNS =
  'id, winner_id, selection_id, campaign_id, prize_id, status, simulated, actual_cost_cents, created_at, updated_at';

function fulfillmentStoreClient(): FulfillmentStoreClient {
  return getSupabaseAdmin() as unknown as FulfillmentStoreClient;
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

function messageHasCode(message: string, code: string): boolean {
  return message === code || new RegExp(`\\b${code}\\b`).test(message);
}

function failureFromDb(error: DbError): FulfillmentStoreError {
  const message = error.message ?? '';
  if (error.code === 'P0002' || messageHasCode(message, 'not_found')) return 'not_found';
  for (const code of FULFILLMENT_ERROR_CODES) {
    if (messageHasCode(message, code)) return code;
  }
  return 'unavailable';
}

function readFulfillment(value: unknown): StoredFulfillment | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const winnerId = readText(row.winner_id);
  const selectionId = readText(row.selection_id);
  const campaignId = readText(row.campaign_id);
  const prizeId = readText(row.prize_id);
  const status = readText(row.status);
  const createdAt = readText(row.created_at);
  const updatedAt = readText(row.updated_at);
  if (
    !id ||
    !winnerId ||
    !selectionId ||
    !campaignId ||
    !prizeId ||
    !status ||
    !isFulfillmentStatus(status) ||
    !createdAt ||
    !updatedAt ||
    row.simulated !== true
  ) {
    return null;
  }
  if (row.actual_cost_cents === null) {
    return {
      id,
      winnerId,
      selectionId,
      campaignId,
      prizeId,
      status,
      simulated: true,
      actualCostCents: null,
      createdAt,
      updatedAt,
    };
  }
  const actualCostCents = readWhole(row.actual_cost_cents);
  if (actualCostCents === null || actualCostCents < 0) return null;
  return {
    id,
    winnerId,
    selectionId,
    campaignId,
    prizeId,
    status,
    simulated: true,
    actualCostCents,
    createdAt,
    updatedAt,
  };
}

function readFulfillmentList(value: unknown): StoredFulfillment[] | null {
  if (!Array.isArray(value)) return null;
  const rows: StoredFulfillment[] = [];
  for (const item of value) {
    const row = readFulfillment(item);
    if (!row) return null;
    rows.push(row);
  }
  return rows;
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

function noteArgument(note: string | null | undefined): string | null {
  if (typeof note !== 'string') return null;
  if (note.trim() === '') return null;
  return note;
}

/**
 * Reads the selection, then create_drawing_fulfillments. A missing
 * selection is not_found and does not call the function, including when
 * the label is blank. A blank label on a selection that exists is
 * invalid_run_by and does not call the function. The function is
 * idempotent and is the only writer.
 */
export async function createFulfillments(
  selectionId: string,
  runBy: string,
  client: FulfillmentStoreClient = fulfillmentStoreClient(),
): Promise<CreateFulfillmentsResult> {
  try {
    const data = await maybeOne(
      client.from('drawing_selections').select(SELECTION_COLUMNS).eq('id', selectionId).maybeSingle(),
    );
    if (data === 'unavailable') return { ok: false, error: 'unavailable' };
    const selection = asRecord(data);
    if (selection === null || readText(selection.id) !== selectionId || selection.simulated !== true) {
      return { ok: false, error: data === null ? 'not_found' : 'unavailable' };
    }
    if (isBlankOperator(runBy)) return { ok: false, error: 'invalid_run_by' };
    let result: { data: unknown; error: DbError | null };
    try {
      result = await client.rpc('create_drawing_fulfillments', {
        p_selection_id: selectionId,
        p_run_by: runBy,
      });
    } catch {
      return { ok: false, error: 'unavailable' };
    }
    if (result.error) {
      const error = failureFromDb(result.error);
      if (error === 'not_found' || error === 'invalid_run_by') return { ok: false, error };
      return { ok: false, error: 'unavailable' };
    }
    const fulfillments = readFulfillmentList(result.data);
    if (!fulfillments || fulfillments.some((row) => row.selectionId !== selectionId)) {
      return { ok: false, error: 'unavailable' };
    }
    return { ok: true, fulfillments };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

/**
 * Loads the row, then checkFulfillmentTransition, then
 * transition_drawing_fulfillment. A missing row is not_found. A blank
 * actor is invalid_actor. Either one skips the function. The function
 * repeats the checks and is the only writer.
 */
export async function transitionFulfillment(
  fulfillmentId: string,
  toStatus: string,
  actor: string,
  options: { note?: string | null; actualCostCents?: number | null } = {},
  client: FulfillmentStoreClient = fulfillmentStoreClient(),
): Promise<TransitionFulfillmentResult> {
  try {
    const data = await maybeOne(
      client.from('drawing_fulfillments').select(FULFILLMENT_COLUMNS).eq('id', fulfillmentId).maybeSingle(),
    );
    if (data === 'unavailable') return { ok: false, error: 'unavailable' };
    const current = readFulfillment(data);
    if (current === null || current.id !== fulfillmentId) {
      return { ok: false, error: data === null ? 'not_found' : 'unavailable' };
    }
    if (isBlankOperator(actor)) return { ok: false, error: 'invalid_actor' };
    const gate = checkFulfillmentTransition(current.status, toStatus, {
      actualCostCents: options.actualCostCents,
      note: options.note,
    });
    if (!gate.ok) return gate;
    let result: { data: unknown; error: DbError | null };
    try {
      result = await client.rpc('transition_drawing_fulfillment', {
        p_fulfillment_id: fulfillmentId,
        p_to_status: toStatus,
        p_actor: actor,
        p_note: noteArgument(options.note),
        p_actual_cost_cents: options.actualCostCents ?? null,
      });
    } catch {
      return { ok: false, error: 'unavailable' };
    }
    if (result.error) {
      const error = failureFromDb(result.error);
      if (
        error === 'not_found' ||
        error === 'invalid_actor' ||
        error === 'invalid_transition' ||
        error === 'cost_required' ||
        error === 'cost_not_allowed' ||
        error === 'drawing_fulfillments_actual_cost_cents_check' ||
        error === 'drawing_fulfillment_events_note_check'
      ) {
        return { ok: false, error };
      }
      return { ok: false, error: 'unavailable' };
    }
    const fulfillment = readFulfillment(result.data);
    if (!fulfillment || fulfillment.id !== fulfillmentId) return { ok: false, error: 'unavailable' };
    return { ok: true, fulfillment };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

/**
 * Every fulfillment for one campaign. Pages are 1000 rows, ordered by
 * created_at then id in the query. The loaded rows are ordered again by
 * instant, then id, so an offset string and a Z string of two different
 * moments stay in instant order. No rows is an empty list.
 */
export async function listFulfillments(
  campaignId: string,
  client: FulfillmentStoreClient = fulfillmentStoreClient(),
): Promise<ListFulfillmentsResult> {
  try {
    const rows: unknown[] = [];
    let from = 0;
    for (;;) {
      const page = await maybeOne(
        client
          .from('drawing_fulfillments')
          .select(FULFILLMENT_COLUMNS)
          .eq('campaign_id', campaignId)
          .order('created_at')
          .order('id')
          .range(from, from + FULFILLMENT_PAGE_SIZE - 1),
      );
      if (page === 'unavailable') return { ok: false, error: 'unavailable' };
      if (!Array.isArray(page)) return { ok: false, error: 'unavailable' };
      rows.push(...page);
      if (page.length < FULFILLMENT_PAGE_SIZE) break;
      from += FULFILLMENT_PAGE_SIZE;
    }
    const fulfillments = readFulfillmentList(rows);
    if (!fulfillments || fulfillments.some((row) => row.campaignId !== campaignId)) {
      return { ok: false, error: 'unavailable' };
    }
    fulfillments.sort((left, right) => {
      const byTime = compareCreatedAt(left.createdAt, right.createdAt);
      if (byTime !== 0) return byTime;
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    });
    return { ok: true, fulfillments };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}
