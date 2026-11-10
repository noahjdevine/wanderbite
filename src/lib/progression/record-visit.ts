import 'server-only';

export type ProgressionLedgerCounts = {
  events: number;
  milestones: number;
  entries: number;
};

export type RecordVerifiedVisitProgressResult = {
  status: 'recorded' | 'replay' | 'skipped' | 'error';
  counts: ProgressionLedgerCounts;
};

type ProgressionLedgerRpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

/**
 * `record_verified_visit_progress` is not in database.types.ts.
 * Callers pass the service-role client through this shape.
 */
export type ProgressionLedgerClient = {
  rpc: (
    fn: 'record_verified_visit_progress',
    args: { p_redemption_id: string },
  ) => PromiseLike<ProgressionLedgerRpcResult>;
};

function emptyCounts(): ProgressionLedgerCounts {
  return { events: 0, milestones: 0, entries: 0 };
}

function failure(): RecordVerifiedVisitProgressResult {
  return { status: 'error', counts: emptyCounts() };
}

function skipped(): RecordVerifiedVisitProgressResult {
  return { status: 'skipped', counts: emptyCounts() };
}

function isPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodePayload(data: unknown): Record<string, unknown> | 'null' | 'invalid' {
  let value = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return 'invalid';
    }
  }
  if (value === null) return 'null';
  if (!isPayload(value)) return 'invalid';
  return value;
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

/**
 * Reads the jsonb from `record_verified_visit_progress`. Null is the
 * function's "write nothing" result. Any other shape that is not
 * `{ events, milestones, entries }` arrays is an error. This does not throw.
 */
export function parseVerifiedVisitProgress(data: unknown): RecordVerifiedVisitProgressResult {
  const payload = decodePayload(data);
  if (payload === 'null') return skipped();
  if (payload === 'invalid') return failure();
  const events = arrayLength(payload.events);
  const milestones = arrayLength(payload.milestones);
  const entries = arrayLength(payload.entries);
  if (events === null || milestones === null || entries === null) return failure();
  const counts = { events, milestones, entries };
  if (events === 0 && milestones === 0 && entries === 0) {
    return { status: 'replay', counts };
  }
  return { status: 'recorded', counts };
}

/**
 * Records one verified visit. A PostgREST error, a throw (including a
 * timeout rejection), null, or malformed jsonb does not throw.
 * Empty arrays are a replay. At least one inserted row is recorded.
 * The flag gate lives with the caller.
 */
export async function recordVerifiedVisitProgress(
  supabase: ProgressionLedgerClient,
  redemptionId: string,
): Promise<RecordVerifiedVisitProgressResult> {
  try {
    const { data, error } = await supabase.rpc('record_verified_visit_progress', {
      p_redemption_id: redemptionId,
    });
    if (error) return failure();
    return parseVerifiedVisitProgress(data);
  } catch {
    return failure();
  }
}
