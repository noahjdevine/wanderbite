import { addMinutes } from 'date-fns';

/**
 * Issued QR lifetime. Noah, 2026-11-03: 15 minutes.
 * Issuance, the expire-issued-redemptions cron, and member copy all use this.
 * Visit windows (`challenge_items.redemption_deadline`) and credit expiry stay separate.
 */
export const REDEMPTION_TTL_MINUTES = 15;

/** Member-facing lifetime. The only spelled-out duration for a redemption code. */
export const REDEMPTION_CODE_LIFETIME_LABEL = `${REDEMPTION_TTL_MINUTES} minutes`;

export const VISIT_WINDOW_CLOSED_MESSAGE = 'This visit window has closed.';

export type RedemptionClock = {
  status: string;
  expiresAt: string;
};

export type RedemptionCodeResult =
  | { state: 'issued'; code: string; expiresAt: string }
  | { state: 'expired'; expiresAt: string | null }
  | { state: 'verified'; verifiedAt: string | null }
  | { state: 'unavailable' };

/** Code expiry from `from`. A duration, so the process timezone does not move it. */
export function redemptionExpiresAt(from: Date = new Date()): Date {
  return addMinutes(from, REDEMPTION_TTL_MINUTES);
}

/**
 * A code cannot outlive the visit window. A null deadline is the legacy path
 * (no visit window) and is left uncapped.
 */
export function capRedemptionExpiresAt(expiresAt: Date, redemptionDeadline: Date | null): Date {
  if (!redemptionDeadline) return expiresAt;
  return expiresAt.getTime() <= redemptionDeadline.getTime() ? expiresAt : new Date(redemptionDeadline.getTime());
}

/** True when the stored code is still `issued` and `expires_at` is after `now`. */
export function redemptionCodeStillValid(row: RedemptionClock, now: Date): boolean {
  if (row.status !== 'issued') return false;
  const expires = new Date(row.expiresAt).getTime();
  return !Number.isNaN(expires) && expires > now.getTime();
}

/**
 * Visit window is open when there is no deadline, or the deadline is still after `now`.
 * A closed window is what expires the challenge item. A code's own expiry does not.
 */
export function visitWindowOpen(redemptionDeadline: string | null | undefined, now: Date): boolean {
  if (!redemptionDeadline) return true;
  const deadline = new Date(redemptionDeadline).getTime();
  if (Number.isNaN(deadline)) return false;
  return deadline > now.getTime();
}

/** Remaining time until the server deadline. Not a timer that starts at 15:00 on render. */
export function formatRedemptionCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (days > 0) return `${days}d ${hours}:${mm}:${ss}`;
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

export type IssuedCodeExpiryRow = {
  id: string;
  status: string;
  expiresAt: string;
};

/**
 * Cron selection for the code clock only. An issued row whose `expires_at` is at
 * or before `asOf` expires. The challenge item and its visit window are not inputs:
 * `expire_version_bound_assignment` is the only path that expires the item.
 */
export function selectIssuedCodesToExpire(
  rows: readonly IssuedCodeExpiryRow[],
  asOf: Date,
): string[] {
  const cutoff = asOf.getTime();
  return rows
    .filter((row) => {
      if (row.status !== 'issued') return false;
      const expires = new Date(row.expiresAt).getTime();
      return !Number.isNaN(expires) && expires <= cutoff;
    })
    .map((row) => row.id);
}
