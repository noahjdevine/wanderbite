import { chicagoCalendarDate } from '@/lib/activities/match';
import { pluralNoun } from '@/lib/format/text';
import type { VisitStatus } from '@/lib/visits/visit-status';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export type AdventureStatId = 'verified' | 'codes' | 'swaps';

export type AdventureStatTile = {
  id: AdventureStatId;
  value: string;
  suffix?: string;
  label: string;
};

/** Month name for a Chicago `yyyy-MM-dd` cycle, otherwise the Chicago month of `now`. */
export function adventureMonthName(cycleMonth: string | null | undefined, now: Date): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(cycleMonth ?? '');
  if (match) {
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return MONTHS[month - 1];
  }
  const iso = chicagoCalendarDate(now);
  const month = Number(iso.slice(5, 7));
  return MONTHS[month - 1] ?? '';
}

/** Days after today through the last America/Chicago calendar day of this month. */
export function daysLeftInChicagoMonth(now: Date): number {
  const iso = chicagoCalendarDate(now);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return 0;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.max(0, last - day);
}

export function daysLeftLabel(days: number): string {
  if (days <= 0) return 'Last day of this month';
  if (days === 1) return '1 day left this month';
  return `${days} days left this month`;
}

/**
 * Swaps the header may show. A missing cycle and a missing credits allowance
 * are not a swap count. Credits win when both are loaded, matching the page.
 */
export function swapsRemainingForHeader(
  cycleSwapCount: number | null,
  creditsSwapRemaining: number | null,
): number | null {
  if (creditsSwapRemaining != null) return creditsSwapRemaining;
  if (cycleSwapCount != null) return Math.max(0, 1 - cycleSwapCount);
  return null;
}

/**
 * Glass tiles from loaded challenge items and the loaded swap allowance.
 * An empty list means that number was not loaded. Zero is kept when the
 * source exists.
 */
export function adventureStatTiles(input: {
  activeItems: { visitStatus?: VisitStatus | null }[] | null;
  swapsRemaining: number | null;
}): AdventureStatTile[] {
  const tiles: AdventureStatTile[] = [];
  const items = input.activeItems;
  if (items && items.length > 0) {
    const verified = items.filter(
      (item) => item.visitStatus === 'verified' || item.visitStatus === 'note_added',
    ).length;
    const codes = items.filter((item) => item.visitStatus === 'code_issued').length;
    tiles.push({
      id: 'verified',
      value: String(verified),
      suffix: `/${items.length}`,
      label: 'verified',
    });
    tiles.push({
      id: 'codes',
      value: String(codes),
      label: pluralNoun(codes, 'code issued', 'codes issued'),
    });
  }
  if (input.swapsRemaining != null) {
    tiles.push({
      id: 'swaps',
      value: String(input.swapsRemaining),
      label: pluralNoun(input.swapsRemaining, 'swap left', 'swaps left'),
    });
  }
  return tiles;
}
