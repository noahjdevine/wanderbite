/**
 * Pure simulated drawing selection.
 *
 * This is the same draw as select_drawing_winners (E09-B5). Eligible
 * entries are ordered by the lowercase hex SHA-256 of the UTF-8 bytes of
 * `seed || entryId` (no separator), then by entry id. Prize units are
 * ordered by position, then prize id, then unit index from 1. Walking
 * that entry order, a member who already received a unit is skipped.
 * `rank` is the 1-based place of the winning entry in the eligible
 * order, including places that were skipped. No clock and no database.
 */

import { createHash } from 'node:crypto';

/** Stored on drawing_selections.algorithm_version. */
export const DRAWING_SELECTION_ALGORITHM = 'v1-sha256-rank';

/**
 * Stable rejection codes shared with select_drawing_winners.
 * checkSelectionAllowed returns the campaign-state codes. The database
 * raises invalid_run_by, invalid_seed, and no_eligible_entries later,
 * in that order, and the store uses the same strings.
 */
export const SELECTION_ERROR_CODES = [
  'not_found',
  'live_selection_blocked',
  'campaign_not_closed',
  'already_selected',
  'invalid_run_by',
  'invalid_seed',
  'no_eligible_entries',
] as const;

export type SelectionErrorCode = (typeof SELECTION_ERROR_CODES)[number];

export type SelectionGateError =
  | 'not_found'
  | 'live_selection_blocked'
  | 'campaign_not_closed'
  | 'already_selected';

/** Fields the gate reads. Timestamps are the stored instants, or null. */
export type SelectionCampaignGate = {
  status: string;
  mode: string;
  activatedAt: string | null;
  closedAt: string | null;
};

export type SelectionGateResult = { ok: true } | { ok: false; error: SelectionGateError };

export type SelectionEntry = {
  id: string;
  userId: string;
};

export type SelectionPrize = {
  id: string;
  position: number;
  quantity: number;
};

export type SelectedWinner = {
  prizeId: string;
  unitIndex: number;
  entryId: string;
  userId: string;
  rank: number;
};

export type EligibleEntry = SelectionEntry & {
  quarterKey: string;
  entrySource: string;
  /** Milestone reached_at, as an ISO instant with a zone. */
  reachedAt: string;
};

export type SelectionEligibility = {
  quarterKey: string;
  eligibleEntrySources: readonly string[];
  /** Campaign closed_at. reachedAt must be strictly earlier. */
  closedAt: string;
};

export type SelectWinnersInput = {
  seed: string;
  entries: readonly SelectionEntry[];
  prizes: readonly SelectionPrize[];
  algorithmVersion: string;
};

export type SelectWinnersSuccess = {
  ok: true;
  winners: SelectedWinner[];
  eligibleEntryCount: number;
  eligibleMemberCount: number;
  prizeUnitCount: number;
  unfilledUnitCount: number;
};

export type SelectWinnersResult =
  | SelectWinnersSuccess
  | { ok: false; error: 'invalid_seed' | 'unknown_algorithm' | 'invalid_prize' };

const SEED_HEX = /^[0-9a-f]{64}$/;

const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Campaign state gate. Same order as select_drawing_winners: missing row,
 * live mode, not a closed activated sample campaign, then an existing draw.
 * A live campaign is rejected before the closed check. Null activated_at
 * or closed_at is campaign_not_closed (never activated, or closed directly).
 */
export function checkSelectionAllowed(
  campaign: SelectionCampaignGate | null,
  existingSelection: { id: string } | null,
): SelectionGateResult {
  if (campaign === null || typeof campaign !== 'object') return { ok: false, error: 'not_found' };
  if (campaign.mode === 'live') return { ok: false, error: 'live_selection_blocked' };
  if (
    campaign.status !== 'closed' ||
    !present(campaign.activatedAt) ||
    !present(campaign.closedAt) ||
    campaign.mode !== 'sample'
  ) {
    return { ok: false, error: 'campaign_not_closed' };
  }
  if (existingSelection !== null && present(existingSelection.id)) {
    return { ok: false, error: 'already_selected' };
  }
  return { ok: true };
}

/** True when the operator label is missing or only whitespace. The database trims too. */
export function isBlankRunBy(runBy: string): boolean {
  return typeof runBy !== 'string' || runBy.trim() === '';
}

/**
 * Entries this draw will rank. Quarter and source must match exactly.
 * reachedAt must be strictly before closedAt. An instant with no zone, or
 * one that does not parse, is not eligible. Comparison uses the instant,
 * not the process time zone.
 */
export function filterEligibleEntries(
  entries: readonly EligibleEntry[],
  gate: SelectionEligibility,
): EligibleEntry[] {
  const closed = instantMicros(gate.closedAt);
  if (closed === null || typeof gate.quarterKey !== 'string') return [];
  const sources = new Set(gate.eligibleEntrySources);
  const eligible: EligibleEntry[] = [];
  for (const entry of entries) {
    if (entry.quarterKey !== gate.quarterKey) continue;
    if (typeof entry.entrySource !== 'string' || !sources.has(entry.entrySource)) continue;
    const reached = instantMicros(entry.reachedAt);
    if (reached === null || reached >= closed) continue;
    eligible.push(entry);
  }
  return eligible;
}

/** Lowercase hex SHA-256 of the UTF-8 bytes of seed concatenated with entryId. */
export function entryRankHex(seed: string, entryId: string): string {
  return createHash('sha256').update(seed + entryId, 'utf8').digest('hex');
}

/** sha256 hex, then entry id. Equal hashes break toward the lower entry id text. */
export function compareRanked(
  left: { rankKey: string; id: string },
  right: { rankKey: string; id: string },
): number {
  if (left.rankKey < right.rankKey) return -1;
  if (left.rankKey > right.rankKey) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/**
 * Assign prize units. `entries` are the eligible set, not a raw quarter.
 * An empty set returns zero winners and unfilled equal to the prize units.
 * The database raises no_eligible_entries instead of storing that case.
 */
export function selectWinners(input: SelectWinnersInput): SelectWinnersResult {
  if (input.algorithmVersion !== DRAWING_SELECTION_ALGORITHM) {
    return { ok: false, error: 'unknown_algorithm' };
  }
  if (typeof input.seed !== 'string' || !SEED_HEX.test(input.seed)) {
    return { ok: false, error: 'invalid_seed' };
  }
  const units = expandUnits(input.prizes);
  if (units === null) return { ok: false, error: 'invalid_prize' };

  const ordered = [...input.entries].sort((left, right) =>
    compareRanked(
      { rankKey: entryRankHex(input.seed, left.id), id: left.id },
      { rankKey: entryRankHex(input.seed, right.id), id: right.id },
    ),
  );
  const won = new Set<string>();
  const winners: SelectedWinner[] = [];
  for (let index = 0; index < ordered.length && winners.length < units.length; index += 1) {
    const entry = ordered[index];
    if (won.has(entry.userId)) continue;
    won.add(entry.userId);
    const unit = units[winners.length];
    winners.push({
      prizeId: unit.prizeId,
      unitIndex: unit.unitIndex,
      entryId: entry.id,
      userId: entry.userId,
      rank: index + 1,
    });
  }
  const members = new Set(input.entries.map((entry) => entry.userId));
  return {
    ok: true,
    winners,
    eligibleEntryCount: input.entries.length,
    eligibleMemberCount: members.size,
    prizeUnitCount: units.length,
    unfilledUnitCount: units.length - winners.length,
  };
}

export type StoredSelectionShape = {
  winners: readonly SelectedWinner[];
  eligibleEntryCount: number;
  eligibleMemberCount: number;
  prizeUnitCount: number;
  unfilledUnitCount: number;
};

/**
 * Field-by-field check of a stored draw against a recompute.
 * Count drift is a mismatch even when the winner rows still agree,
 * because a later entry can change the odds without taking a prize.
 */
export function explainSelectionMatch(
  stored: StoredSelectionShape,
  recomputed: SelectWinnersSuccess,
): { match: true } | { match: false; reason: string } {
  if (stored.eligibleEntryCount !== recomputed.eligibleEntryCount) {
    return { match: false, reason: 'eligible_entry_count' };
  }
  if (stored.eligibleMemberCount !== recomputed.eligibleMemberCount) {
    return { match: false, reason: 'eligible_member_count' };
  }
  if (stored.prizeUnitCount !== recomputed.prizeUnitCount) {
    return { match: false, reason: 'prize_unit_count' };
  }
  if (stored.unfilledUnitCount !== recomputed.unfilledUnitCount) {
    return { match: false, reason: 'unfilled_unit_count' };
  }
  if (stored.winners.length !== recomputed.winners.length) {
    return { match: false, reason: 'winners' };
  }
  const left = [...stored.winners].sort((a, b) => a.rank - b.rank);
  const right = [...recomputed.winners].sort((a, b) => a.rank - b.rank);
  for (let index = 0; index < left.length; index += 1) {
    const storedWinner = left[index];
    const fresh = right[index];
    if (
      storedWinner.entryId !== fresh.entryId ||
      storedWinner.userId !== fresh.userId ||
      storedWinner.prizeId !== fresh.prizeId ||
      storedWinner.unitIndex !== fresh.unitIndex ||
      storedWinner.rank !== fresh.rank
    ) {
      return { match: false, reason: 'winners' };
    }
  }
  return { match: true };
}

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function expandUnits(prizes: readonly SelectionPrize[]): { prizeId: string; unitIndex: number }[] | null {
  const ordered = [...prizes].sort((left, right) => {
    if (left.position !== right.position) return left.position - right.position;
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  });
  const units: { prizeId: string; unitIndex: number }[] = [];
  for (const prize of ordered) {
    if (!Number.isSafeInteger(prize.position)) return null;
    if (!Number.isSafeInteger(prize.quantity) || prize.quantity < 1) return null;
    for (let unitIndex = 1; unitIndex <= prize.quantity; unitIndex += 1) {
      units.push({ prizeId: prize.id, unitIndex });
    }
  }
  return units;
}

/**
 * Microseconds since the Unix epoch. Fractional seconds past the
 * millisecond are kept. Zone-less strings are rejected so the process
 * time zone cannot move the comparison. Z and a numeric offset are the
 * same instant.
 */
export function instantMicros(value: string): bigint | null {
  if (typeof value !== 'string') return null;
  const match = INSTANT.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? '';
  const zone = match[8];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) {
    return null;
  }
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(utcMs)) return null;
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const zoneHours = Number(zone.slice(1, 3));
    const zoneMinutes = Number(zone.slice(4, 6));
    if (zoneHours > 23 || zoneMinutes > 59) return null;
    utcMs -= sign * (zoneHours * 60 + zoneMinutes) * 60_000;
  }
  const micros = (fraction + '000000').slice(0, 6);
  return BigInt(utcMs) * BigInt(1000) + BigInt(micros);
}
