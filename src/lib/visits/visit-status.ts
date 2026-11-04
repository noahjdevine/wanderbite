import { visitWindowOpen } from '@/lib/redemption-expiry';

/**
 * One derived status for a challenge item.
 *
 * Stored values this reconciles:
 * - `challenge_items.status`: `assigned` | `swapped_out` | `redeemed` | `expired`
 * - `redemptions.status`: `issued` | `verified` | `expired`
 * A swap is stored as `swapped_out`. A revealed item stays `assigned`.
 * There is no stored ready / code_issued / note_added value.
 *
 * Clocks stay separate. `expiresAt` is the QR code. `redemptionDeadline` is the
 * visit window. Credit expiry is not an input and never changes this status.
 */
export type VisitStatus =
  | 'ready'
  | 'code_issued'
  | 'code_expired'
  | 'verified'
  | 'note_added'
  | 'expired'
  | 'swapped';

export type VisitStatusItem = {
  status: string;
  redemptionDeadline: string | null;
};

export type VisitStatusRedemption = {
  status: string;
  verifiedAt: string | null;
  expiresAt: string | null;
};

/**
 * A bite_notes row for the redemption. The row is the note: a null body still
 * counts. Pass null when no row exists.
 */
export type VisitNote = {
  note: string | null;
};

export type DeriveVisitStatusInput = {
  item: VisitStatusItem | null;
  redemption: VisitStatusRedemption | null;
  note: VisitNote | null;
  now: Date;
};

const CODE_EXPIRED_LABEL = 'Code expired. Get a new one';
const ADVENTURE_ENDED_LABEL = 'This adventure is no longer active.';

export function visitStatusLabel(status: VisitStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'code_issued':
      return 'Code issued';
    case 'code_expired':
      return CODE_EXPIRED_LABEL;
    case 'verified':
      return 'Verified';
    case 'note_added':
      return 'Note added';
    case 'expired':
      return ADVENTURE_ENDED_LABEL;
    case 'swapped':
      return 'Swapped';
  }
}

/** Passport, Journey, badges, XP, savings, and streak count only these. */
export function visitStatusCountsAsVisit(status: VisitStatus): boolean {
  return status === 'verified' || status === 'note_added';
}

function isVerified(redemption: VisitStatusRedemption): boolean {
  return redemption.status === 'verified';
}

function codeStillIssued(redemption: VisitStatusRedemption, now: Date): boolean {
  if (redemption.status !== 'issued') return false;
  if (!redemption.expiresAt) return false;
  const expires = new Date(redemption.expiresAt).getTime();
  return !Number.isNaN(expires) && expires > now.getTime();
}

function codeClockExpired(redemption: VisitStatusRedemption, now: Date): boolean {
  if (redemption.status === 'expired') return true;
  if (redemption.status !== 'issued') return false;
  return !codeStillIssued(redemption, now);
}

function windowClosed(deadline: string | null, now: Date): boolean {
  return !visitWindowOpen(deadline, now);
}

/**
 * Precedence: a verified redemption wins over a later window close, item
 * `expired`, code expiry, and swap. Otherwise a swapped-out item is `swapped`.
 * A closed visit window or item status `expired` is `expired` when nothing is
 * verified. An issued code whose `expires_at` is at or before `now` is
 * `code_expired` only while that window is still open.
 */
export function deriveVisitStatus(input: DeriveVisitStatusInput): VisitStatus {
  const { item, redemption, note, now } = input;
  if (redemption && isVerified(redemption)) {
    return note ? 'note_added' : 'verified';
  }
  if (item?.status === 'swapped_out') return 'swapped';
  const deadline = item?.redemptionDeadline ?? null;
  if (item?.status === 'expired' || windowClosed(deadline, now)) return 'expired';
  if (redemption && codeClockExpired(redemption, now)) return 'code_expired';
  if (redemption && codeStillIssued(redemption, now)) return 'code_issued';
  return 'ready';
}
