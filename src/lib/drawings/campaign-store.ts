import 'server-only';

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  CAMPAIGN_ERROR_CODES,
  CAMPAIGN_TRANSITION_ERROR_CODES,
  campaignWindow,
  checkCampaignEdit,
  checkCampaignTransition,
  validateCampaignDraft,
  type CampaignDraft,
  type CampaignErrorCode,
  type CampaignMode,
  type CampaignPrize,
  type CampaignStatus,
  type CampaignTransitionError,
  type CampaignTransitionState,
} from '@/lib/drawings/campaign';

/**
 * Server-only writer for drawing campaigns. Create and update run the B1
 * checks first, then save_drawing_campaign. Activate and close run
 * checkCampaignTransition, then transition_drawing_campaign. An active or
 * closed row is campaign_locked here and in the database. Admin drawing
 * actions call activateCampaign and closeCampaign when their flag is on.
 * The admin campaign editor calls createCampaign and updateCampaign when
 * its flag is on. The tables are not in database.types.ts; row shapes
 * below are local.
 */

export type { CampaignStatus };

export type StoredCampaignPrize = {
  id: string;
  campaignId: string;
  label: string;
  quantity: number;
  unitValueCents: number;
  isSample: boolean;
  position: number;
};

export type StoredCampaign = {
  id: string;
  quarterKey: string;
  mode: CampaignMode;
  rulesVersion: string;
  status: CampaignStatus;
  totalBudgetCents: number;
  fulfillmentAllowanceCents: number;
  eligibleEntrySources: string[];
  startsAt: string;
  endsAt: string;
  createdAt: string;
  updatedAt: string;
  prizes: StoredCampaignPrize[];
  /** quantity × unit value, plus the fulfillment allowance. Not a stored column. */
  committedCents: number;
};

export type CampaignWritePayload = {
  id?: string;
  quarter_key: string;
  mode: CampaignMode;
  rules_version: string;
  total_budget_cents: number;
  fulfillment_allowance_cents: number;
  eligible_entry_sources: string[];
  starts_at: string;
  ends_at: string;
  prizes: {
    label: string;
    quantity: number;
    unit_value_cents: number;
    is_sample: boolean;
    position: number;
  }[];
};

export type CampaignStoreError =
  | 'not_found'
  | 'unavailable'
  | 'quarter_campaign_open'
  | 'campaign_locked'
  | CampaignTransitionError;

export type CampaignStoreResult =
  | { ok: true; campaign: StoredCampaign }
  | { ok: false; errors: CampaignErrorCode[] }
  | { ok: false; error: CampaignStoreError };

export type CampaignReadResult =
  | { ok: true; campaign: StoredCampaign }
  | { ok: false; error: 'not_found' | 'unavailable' };

type DbError = { message?: string; code?: string };

type CampaignPage = {
  data: unknown;
  error: DbError | null;
};

type CampaignQuery = {
  select: (columns: string) => {
    eq: (
      column: string,
      value: string,
    ) => {
      maybeSingle: () => PromiseLike<CampaignPage>;
      order: (column: string) => PromiseLike<CampaignPage>;
    };
  };
};

export type CampaignTransitionArgs = {
  p_campaign_id: string;
  p_to_status: 'active' | 'closed';
};

export type CampaignStoreClient = {
  rpc: (
    fn: 'save_drawing_campaign' | 'transition_drawing_campaign',
    args: { p_payload: CampaignWritePayload } | CampaignTransitionArgs,
  ) => PromiseLike<{ data: unknown; error: DbError | null }>;
  from: (table: 'drawing_campaigns' | 'drawing_campaign_prizes') => CampaignQuery;
};

const CAMPAIGN_COLUMNS =
  'id, quarter_key, mode, rules_version, status, total_budget_cents, fulfillment_allowance_cents, eligible_entry_sources, starts_at, ends_at, created_at, updated_at';

const PRIZE_COLUMNS = 'id, campaign_id, label, quantity, unit_value_cents, is_sample, position';

const CODE_PATTERN = new RegExp(`\\b(${CAMPAIGN_ERROR_CODES.join('|')})\\b`);

function campaignStoreClient(): CampaignStoreClient {
  return getSupabaseAdmin() as unknown as CampaignStoreClient;
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

function readMode(value: unknown): CampaignMode | null {
  return value === 'sample' || value === 'live' ? value : null;
}

function readStatus(value: unknown): CampaignStatus | null {
  return value === 'draft' || value === 'active' || value === 'closed' ? value : null;
}

function readSources(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((source) => typeof source !== 'string')) return null;
  return value as string[];
}

function readPrize(value: unknown): StoredCampaignPrize | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const campaignId = readText(row.campaign_id);
  const label = typeof row.label === 'string' ? row.label : null;
  const quantity = readWhole(row.quantity);
  const unitValueCents = readWhole(row.unit_value_cents);
  const position = readWhole(row.position);
  if (!id || !campaignId || label === null || quantity === null || unitValueCents === null || position === null) {
    return null;
  }
  if (typeof row.is_sample !== 'boolean') return null;
  return {
    id,
    campaignId,
    label,
    quantity,
    unitValueCents,
    isSample: row.is_sample,
    position,
  };
}

function readCampaign(value: unknown, prizeValue?: unknown): StoredCampaign | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const quarterKey = readText(row.quarter_key);
  const mode = readMode(row.mode);
  const rulesVersion = typeof row.rules_version === 'string' ? row.rules_version : null;
  const status = readStatus(row.status);
  const totalBudgetCents = readWhole(row.total_budget_cents);
  const fulfillmentAllowanceCents = readWhole(row.fulfillment_allowance_cents);
  const eligibleEntrySources = readSources(row.eligible_entry_sources);
  const startsAt = readText(row.starts_at);
  const endsAt = readText(row.ends_at);
  const createdAt = readText(row.created_at);
  const updatedAt = readText(row.updated_at);
  const prizeRows = prizeValue === undefined ? row.prizes : prizeValue;
  if (
    !id ||
    !quarterKey ||
    !mode ||
    rulesVersion === null ||
    !status ||
    totalBudgetCents === null ||
    fulfillmentAllowanceCents === null ||
    !eligibleEntrySources ||
    !startsAt ||
    !endsAt ||
    !createdAt ||
    !updatedAt ||
    !Array.isArray(prizeRows)
  ) {
    return null;
  }
  const prizes: StoredCampaignPrize[] = [];
  for (const prize of prizeRows) {
    const stored = readPrize(prize);
    if (!stored || stored.campaignId !== id) return null;
    prizes.push(stored);
  }
  prizes.sort((left, right) => left.position - right.position);
  let committedCents = fulfillmentAllowanceCents;
  for (const prize of prizes) {
    const product = prize.quantity * prize.unitValueCents;
    if (!Number.isSafeInteger(product)) return null;
    committedCents += product;
    if (!Number.isSafeInteger(committedCents)) return null;
  }
  return {
    id,
    quarterKey,
    mode,
    rulesVersion,
    status,
    totalBudgetCents,
    fulfillmentAllowanceCents,
    eligibleEntrySources,
    startsAt,
    endsAt,
    createdAt,
    updatedAt,
    prizes,
    committedCents,
  };
}

function draftFromStored(campaign: StoredCampaign): CampaignDraft {
  const prizes: CampaignPrize[] = campaign.prizes.map((prize) => ({
    label: prize.label,
    quantity: prize.quantity,
    unitValueCents: prize.unitValueCents,
    isSample: prize.isSample,
  }));
  return {
    quarterKey: campaign.quarterKey,
    mode: campaign.mode,
    rulesVersion: campaign.rulesVersion,
    totalBudgetCents: campaign.totalBudgetCents,
    fulfillmentAllowanceCents: campaign.fulfillmentAllowanceCents,
    prizes,
    eligibleEntrySources: campaign.eligibleEntrySources,
  };
}

function payloadFor(draft: CampaignDraft, id?: string): CampaignWritePayload | null {
  const window = campaignWindow(draft.quarterKey);
  if (!window) return null;
  return {
    ...(id ? { id } : {}),
    quarter_key: draft.quarterKey,
    mode: draft.mode,
    rules_version: draft.rulesVersion,
    total_budget_cents: draft.totalBudgetCents,
    fulfillment_allowance_cents: draft.fulfillmentAllowanceCents,
    eligible_entry_sources: [...draft.eligibleEntrySources],
    starts_at: window.startsAt,
    ends_at: window.endsAt,
    prizes: draft.prizes.map((prize, position) => ({
      label: prize.label,
      quantity: prize.quantity,
      unit_value_cents: prize.unitValueCents,
      is_sample: prize.isSample,
      position,
    })),
  };
}

const STORE_ERROR_CODES = [
  'quarter_campaign_open',
  'campaign_locked',
  ...CAMPAIGN_TRANSITION_ERROR_CODES,
] as const;

function messageHasCode(message: string, code: string): boolean {
  return message === code || new RegExp(`\\b${code}\\b`).test(message);
}

function failureFromDb(error: DbError): CampaignStoreResult {
  const message = error.message ?? '';
  if (
    error.code === '23505' ||
    message.includes('drawing_campaigns_one_open_quarter_idx') ||
    messageHasCode(message, 'quarter_campaign_open')
  ) {
    return { ok: false, error: 'quarter_campaign_open' };
  }
  if (error.code === 'P0002' || messageHasCode(message, 'not_found')) {
    return { ok: false, error: 'not_found' };
  }
  const found = new Set<CampaignErrorCode>();
  const match = CODE_PATTERN.exec(message);
  if (match) {
    const code = match[1];
    if ((CAMPAIGN_ERROR_CODES as readonly string[]).includes(code)) {
      found.add(code as CampaignErrorCode);
    }
  }
  for (const code of CAMPAIGN_ERROR_CODES) {
    if (message === code) found.add(code);
  }
  if (found.size > 0) {
    return { ok: false, errors: CAMPAIGN_ERROR_CODES.filter((code) => found.has(code)) };
  }
  for (const code of STORE_ERROR_CODES) {
    if (messageHasCode(message, code)) return { ok: false, error: code };
  }
  return { ok: false, error: 'unavailable' };
}

function transitionState(campaign: StoredCampaign): CampaignTransitionState {
  return {
    status: campaign.status,
    mode: campaign.mode,
    endsAt: campaign.endsAt,
    prizeCount: campaign.prizes.length,
    totalBudgetCents: campaign.totalBudgetCents,
    committedCents: campaign.committedCents,
  };
}

async function transitionCampaign(
  client: CampaignStoreClient,
  id: string,
  toStatus: 'active' | 'closed',
  now: string,
): Promise<CampaignStoreResult> {
  const current = await getCampaign(id, client);
  if (!current.ok) return current;
  const transition = checkCampaignTransition(transitionState(current.campaign), toStatus, now);
  if (!transition.ok) return { ok: false, error: transition.error };
  let result: { data: unknown; error: DbError | null };
  try {
    result = await client.rpc('transition_drawing_campaign', {
      p_campaign_id: id,
      p_to_status: toStatus,
    });
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  if (result.error) {
    const failed = failureFromDb(result.error);
    if (!failed.ok && 'errors' in failed && failed.errors.length === 1 && failed.errors[0] === 'over_budget') {
      return { ok: false, error: 'over_budget' };
    }
    return failed;
  }
  const campaign = readCampaign(result.data);
  if (!campaign) return { ok: false, error: 'unavailable' };
  return { ok: true, campaign };
}

async function writeCampaign(
  client: CampaignStoreClient,
  payload: CampaignWritePayload,
): Promise<CampaignStoreResult> {
  let result: { data: unknown; error: DbError | null };
  try {
    result = await client.rpc('save_drawing_campaign', { p_payload: payload });
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  if (result.error) return failureFromDb(result.error);
  const campaign = readCampaign(result.data);
  if (!campaign) return { ok: false, error: 'unavailable' };
  return { ok: true, campaign };
}

/**
 * Reads one campaign and its prizes. No row is `not_found`.
 * A failed read is `unavailable`.
 */
export async function getCampaign(
  id: string,
  client: CampaignStoreClient = campaignStoreClient(),
): Promise<CampaignReadResult> {
  try {
    const campaign = await client.from('drawing_campaigns').select(CAMPAIGN_COLUMNS).eq('id', id).maybeSingle();
    if (campaign.error) return { ok: false, error: 'unavailable' };
    if (!campaign.data) return { ok: false, error: 'not_found' };
    const prizes = await client
      .from('drawing_campaign_prizes')
      .select(PRIZE_COLUMNS)
      .eq('campaign_id', id)
      .order('position');
    if (prizes.error || !Array.isArray(prizes.data)) return { ok: false, error: 'unavailable' };
    const stored = readCampaign(campaign.data, prizes.data);
    if (!stored) return { ok: false, error: 'unavailable' };
    return { ok: true, campaign: stored };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

/**
 * Validates with validateCampaignDraft, then writes the campaign and prizes
 * together. A rejected draft does not call the database.
 */
export async function createCampaign(
  draft: CampaignDraft,
  client: CampaignStoreClient = campaignStoreClient(),
): Promise<CampaignStoreResult> {
  const validated = validateCampaignDraft(draft);
  if (!validated.ok) return validated;
  const payload = payloadFor(draft);
  if (!payload) return { ok: false, errors: ['invalid_quarter_key'] };
  return writeCampaign(client, payload);
}

/**
 * Loads the stored campaign and checks the edit with checkCampaignEdit
 * before replacing its prizes. A rejected edit does not call
 * save_drawing_campaign.
 */
export async function updateCampaign(
  id: string,
  next: CampaignDraft,
  client: CampaignStoreClient = campaignStoreClient(),
): Promise<CampaignStoreResult> {
  const current = await getCampaign(id, client);
  if (!current.ok) return current;
  if (current.campaign.status === 'active' || current.campaign.status === 'closed') {
    return { ok: false, error: 'campaign_locked' };
  }
  const edited = checkCampaignEdit(draftFromStored(current.campaign), next);
  if (!edited.ok) return edited;
  const payload = payloadFor(next, id);
  if (!payload) return { ok: false, errors: ['invalid_quarter_key'] };
  return writeCampaign(client, payload);
}

/**
 * Activates a sample draft before its quarter ends. The pure check runs
 * first and uses `now` (default: the current instant). The database
 * repeats that gate inside transition_drawing_campaign.
 */
export async function activateCampaign(
  id: string,
  client: CampaignStoreClient = campaignStoreClient(),
  now: string = new Date().toISOString(),
): Promise<CampaignStoreResult> {
  return transitionCampaign(client, id, 'active', now);
}

/**
 * Closes a draft or an active campaign. A closed campaign returns
 * invalid_transition and does not call the database.
 */
export async function closeCampaign(
  id: string,
  client: CampaignStoreClient = campaignStoreClient(),
  now: string = new Date().toISOString(),
): Promise<CampaignStoreResult> {
  return transitionCampaign(client, id, 'closed', now);
}
