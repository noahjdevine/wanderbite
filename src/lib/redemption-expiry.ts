import { addDays } from 'date-fns';

/** Matches expire-issued-redemptions cron until PROD-05 reads expires_at. */
export const REDEMPTION_TTL_DAYS = 35;

export function redemptionExpiresAt(from: Date = new Date()): Date {
  return addDays(from, REDEMPTION_TTL_DAYS);
}
