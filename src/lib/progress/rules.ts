/**
 * Pure progress rules already used by Journey and partner verification.
 * Month streaks live in `src/lib/streaks.ts` and use America/Chicago.
 */

export const PROGRESS_UNAVAILABLE_MESSAGE = 'Progress temporarily unavailable';

export const NEUTRAL_MEMBER_HEADER = 'Welcome back';

/** 100 XP per verified visit. Same rule as the Journey level card. */
export const XP_PER_VERIFIED_VISIT = 100;

export const XP_LEVELS = [
  { level: 1, minXp: 300, name: 'The Explorer' },
  { level: 2, minXp: 1000, name: 'The Tastemaker' },
  { level: 3, minXp: 1500, name: 'The Connoisseur' },
  { level: 4, minXp: 2500, name: 'The Local Legend' },
] as const;

/**
 * Visit counts that partner verification already awards.
 * Names and icons come from the `badges` table, not from this list.
 */
export const CATALOG_BADGE_TARGETS = [
  { id: 'first_bite', target: 1 },
  { id: 'hat_trick', target: 3 },
  { id: 'wanderer', target: 3 },
  { id: 'high_five', target: 5 },
] as const;

/** Used when a verified visit has no sealed offer tier. Journey already used 1000 cents. */
export const ESTIMATED_SAVINGS_FALLBACK_CENTS = 1000;

export type NextLevel = {
  level: number;
  name: string;
  xp: number;
};

export type LevelSnapshot = {
  level: number;
  name: string;
  nextLevel: NextLevel | null;
  progressPercent: number;
};

export type CatalogBadge = {
  id: string;
  name: string;
  description: string;
  icon: string;
};

export type AssembledBadge = {
  id: string;
  name: string;
  earnedAt: string | null;
  progress: { current: number; target: number };
  description: string;
  icon: string;
};

const TARGET_BY_ID = new Map<string, number>(
  CATALOG_BADGE_TARGETS.map((badge) => [badge.id, badge.target]),
);

export function xpFromVerifiedVisits(verifiedVisits: number): number {
  return verifiedVisits * XP_PER_VERIFIED_VISIT;
}

export function levelFromXp(xp: number): LevelSnapshot {
  for (let i = XP_LEVELS.length - 1; i >= 0; i--) {
    const tier = XP_LEVELS[i];
    const next = XP_LEVELS[i + 1];
    if (xp >= tier.minXp) {
      if (!next) {
        return {
          level: tier.level,
          name: tier.name,
          nextLevel: null,
          progressPercent: 100,
        };
      }
      const range = next.minXp - tier.minXp;
      const progressInLevel = Math.min(xp - tier.minXp, range);
      const progressPercent =
        range > 0 ? Math.min(100, Math.round((progressInLevel / range) * 100)) : 100;
      return {
        level: tier.level,
        name: tier.name,
        nextLevel: { level: next.level, name: next.name, xp: next.minXp },
        progressPercent,
      };
    }
  }
  const first = XP_LEVELS[0];
  return {
    level: 0,
    name: 'Getting started',
    nextLevel: { level: first.level, name: first.name, xp: first.minXp },
    progressPercent: Math.min(100, Math.round((xp / first.minXp) * 100)),
  };
}

export function badgeIdsEarnedByVerifiedVisits(verifiedVisits: number): string[] {
  return CATALOG_BADGE_TARGETS.filter((badge) => verifiedVisits >= badge.target).map(
    (badge) => badge.id,
  );
}

/**
 * First word of the profile name. A blank name, or a token that contains
 * `@`, becomes a neutral greeting so the header never shows an email.
 */
export function memberHeaderLabel(fullName: string | null | undefined): string {
  const first = fullName?.trim().split(/\s+/)[0] ?? '';
  if (!first || first.includes('@')) return NEUTRAL_MEMBER_HEADER;
  return first;
}

/** Calendar date in America/Chicago, so server and browser time zones agree. */
export function formatEarnedOn(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Earned on —';
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  return `Earned on ${formatted}`;
}

function catalogIndex(id: string): number {
  const index = CATALOG_BADGE_TARGETS.findIndex((badge) => badge.id === id);
  return index === -1 ? CATALOG_BADGE_TARGETS.length : index;
}

/**
 * One earned state per catalog badge.
 * A stored `awarded_at` wins. Otherwise the visit rule supplies the timestamp
 * of the visit that crossed the target. This does not write `user_badges`.
 */
export function assembleBadges(args: {
  catalog: readonly CatalogBadge[];
  awardedAtById: ReadonlyMap<string, string | null>;
  verifiedVisits: number;
  verifiedAtAsc: readonly string[];
}): AssembledBadge[] {
  const sorted = [...args.catalog].sort((a, b) => {
    const byCatalog = catalogIndex(a.id) - catalogIndex(b.id);
    if (byCatalog !== 0) return byCatalog;
    return a.id.localeCompare(b.id);
  });
  return sorted.map((badge) => {
    const target = TARGET_BY_ID.get(badge.id);
    const hasRow = args.awardedAtById.has(badge.id);
    const stored = hasRow ? args.awardedAtById.get(badge.id) : undefined;
    const earnedAt = resolveEarnedAt({
      awardedAt: stored,
      target,
      verifiedAtAsc: args.verifiedAtAsc,
    });
    const progressTarget = target ?? 1;
    return {
      id: badge.id,
      name: badge.name,
      description: badge.description,
      icon: badge.icon,
      earnedAt,
      progress: {
        current: Math.min(args.verifiedVisits, progressTarget),
        target: progressTarget,
      },
    };
  });
}

function resolveEarnedAt(args: {
  awardedAt: string | null | undefined;
  target: number | undefined;
  verifiedAtAsc: readonly string[];
}): string | null {
  if (typeof args.awardedAt === 'string' && args.awardedAt.length > 0) {
    return args.awardedAt;
  }
  if (args.target != null && args.verifiedAtAsc.length >= args.target) {
    return args.verifiedAtAsc[args.target - 1] ?? null;
  }
  return null;
}
