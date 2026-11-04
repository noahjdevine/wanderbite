import { pluralize } from '@/lib/format/text';
import {
  buildPassportShare,
  chicagoVisitDate,
  cuisineInk,
  PASSPORT_UNNAMED_DISPLAY,
  stampRotationDegrees,
  type PassportSharePayload,
} from '@/lib/passport/passport-board';
import { NEUTRAL_MEMBER_HEADER } from '@/lib/progress/rules';

/** Portrait, Instagram-friendly. A 1200×630 image is not produced. */
export const PASSPORT_SHARE_IMAGE_WIDTH = 1080;
export const PASSPORT_SHARE_IMAGE_HEIGHT = 1350;

export const PASSPORT_SHARE_STAMP_CAP = 6;

export const PASSPORT_SHARE_IMAGE_PATH = '/api/passport/share-image';

export const PASSPORT_SHARE_FILENAME = 'wanderbite-passport.png';

export const PASSPORT_SHARE_FOOTER = 'wanderbite.co';

const STAMP_NAME_MAX = 22;
const STAMP_NEIGHBORHOOD_MAX = 18;

/**
 * One verified visit the card may draw. Extra fields are ignored so a row
 * that still carries a note, a code, or an id cannot leak onto the image.
 */
export type PassportShareStampSource = {
  restaurantName: string;
  neighborhood: string | null;
  cuisineTags: readonly string[];
  verifiedAt: string;
  note?: string | null;
  redemptionId?: string | null;
  userId?: string | null;
  redemptionCode?: string | null;
};

export type PassportShareLevel = {
  level: number;
  name: string;
};

/**
 * Counts and stamps for one member. `level` is the existing XP ladder when
 * the caller has it, or null when that read did not produce a level.
 * Private fields are accepted and dropped.
 */
export type PassportShareCardSource = {
  displayName: string;
  progressUnavailable: boolean;
  verifiedVisits: number;
  uniqueRestaurants: number;
  neighborhoods: number | null;
  currentStreak: number;
  level: PassportShareLevel | null;
  earnedBadgeCount: number;
  stamps: readonly PassportShareStampSource[];
  privateNotes?: readonly string[];
  email?: string | null;
  redemptionCodes?: readonly string[];
  userId?: string | null;
  redemptionIds?: readonly string[];
};

export type PassportShareCardStamp = {
  name: string;
  dateLabel: string;
  neighborhood: string;
  inkColor: string;
  inkLabel: string;
  rotation: number;
  shape: 'round' | 'rect';
};

export type PassportShareCardModel = {
  title: string;
  levelLabel: string | null;
  badgeLabel: string | null;
  visitLabel: string | null;
  restaurantLabel: string | null;
  neighborhoodLabel: string | null;
  stamps: PassportShareCardStamp[];
  empty: boolean;
  footer: typeof PASSPORT_SHARE_FOOTER;
  share: PassportSharePayload;
};

/**
 * A blank name, the passport fallback "Your", the neutral greeting, or an
 * email token becomes "My Passport". A lone "Your" is not a title.
 */
export function passportShareCardTitle(displayName: string): string {
  const trimmed = displayName.trim();
  if (
    !trimmed ||
    trimmed === PASSPORT_UNNAMED_DISPLAY ||
    trimmed === NEUTRAL_MEMBER_HEADER ||
    trimmed.includes('@')
  ) {
    return 'My Passport';
  }
  return `${trimmed}'s Passport`;
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function stampTime(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Pure card model. Newest verified stamps first, at most six. Dates are
 * America/Chicago short labels. The share payload is the existing text share.
 */
export function buildPassportShareCard(source: PassportShareCardSource): PassportShareCardModel {
  const ordered = source.stamps
    .map((stamp, index) => ({ stamp, index }))
    .sort((a, b) => {
      const delta = stampTime(b.stamp.verifiedAt) - stampTime(a.stamp.verifiedAt);
      if (delta !== 0) return delta;
      return a.index - b.index;
    })
    .slice(0, PASSPORT_SHARE_STAMP_CAP);

  const stamps: PassportShareCardStamp[] = ordered.map(({ stamp }, index) => {
    const name = clip(stamp.restaurantName, STAMP_NAME_MAX);
    const dateLabel = chicagoVisitDate(stamp.verifiedAt)?.short ?? '—';
    const neighborhood = clip(stamp.neighborhood ?? '', STAMP_NEIGHBORHOOD_MAX);
    const ink = cuisineInk(stamp.cuisineTags);
    return {
      name,
      dateLabel,
      neighborhood,
      inkColor: ink.color,
      inkLabel: ink.label,
      rotation: stampRotationDegrees(`${name}|${dateLabel}|${index}`),
      shape: index === 0 ? 'rect' : 'round',
    };
  });

  const levelLabel =
    source.level == null ? null : `Level ${source.level.level} · ${source.level.name}`;
  const badgeLabel =
    source.level == null && source.earnedBadgeCount > 0
      ? pluralize(source.earnedBadgeCount, 'badge')
      : null;

  const countsReady = !source.progressUnavailable;

  return {
    title: passportShareCardTitle(source.displayName),
    levelLabel,
    badgeLabel,
    visitLabel: countsReady ? pluralize(source.verifiedVisits, 'visit') : null,
    restaurantLabel: countsReady ? pluralize(source.uniqueRestaurants, 'restaurant') : null,
    neighborhoodLabel:
      countsReady && source.neighborhoods != null
        ? pluralize(source.neighborhoods, 'neighborhood')
        : null,
    stamps,
    empty: stamps.length === 0,
    footer: PASSPORT_SHARE_FOOTER,
    share: buildPassportShare({
      progressUnavailable: source.progressUnavailable,
      uniqueRestaurants: source.uniqueRestaurants,
      neighborhoods: source.neighborhoods,
      currentStreak: source.currentStreak,
    }),
  };
}
