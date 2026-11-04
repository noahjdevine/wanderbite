'use client';

import { useEffect, useState } from 'react';
import { differenceInMilliseconds } from 'date-fns';
import { stampKind } from '@/lib/passport/passport-board';
import type { VisitStatus } from '@/lib/visits/visit-status';

/** Seen redemption ids for this browser. Not a server column. */
export const SEEN_STAMPS_STORAGE_KEY = 'wb_seen_stamps';

/** First-run seeding window. Older than this, and not yet seeded, does not slam. */
export const STAMP_UNLOCK_WINDOW_MS = 24 * 60 * 60 * 1000;

export type StampUnlockCandidate = {
  id: string;
  status: VisitStatus;
  verifiedAt: string | null;
};

/**
 * `ids` are redemption ids already shown.
 * `seeded` is true after the passport page has applied the first-run rule
 * to the stamps it could see. A redemption screen can mark one id without
 * setting this, so a later passport open still seeds the older stamps.
 */
export type StampSeenFile = {
  ids: string[];
  seeded: boolean;
};

export type SeenState =
  | { kind: 'missing' }
  | { kind: 'ready'; ids: readonly string[]; seeded: boolean }
  | { kind: 'unusable' };

export type StampUnlockStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type StampUnlockPlan = {
  /** Play the slam. Null when reduced motion, storage failed, or nothing is new. */
  slamId: string | null;
  /** Polite announcement target, including when reduced motion skips the slam. */
  announceId: string | null;
  /** Replacement file. Null when nothing should be written. */
  write: StampSeenFile | null;
};

const EMPTY_PLAN: StampUnlockPlan = { slamId: null, announceId: null, write: null };

/**
 * Parse the storage value. Null is a first run. Anything that is not
 * `{ ids: string[], seeded: boolean }` is unusable: the caller skips the slam.
 */
export function readSeenState(raw: string | null): SeenState {
  if (raw == null) return { kind: 'missing' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'unusable' };
    const record = parsed as { ids?: unknown; seeded?: unknown };
    if (!Array.isArray(record.ids) || typeof record.seeded !== 'boolean') return { kind: 'unusable' };
    const ids: string[] = [];
    for (const id of record.ids) {
      if (typeof id !== 'string' || id.length === 0) return { kind: 'unusable' };
      ids.push(id);
    }
    return { kind: 'ready', ids, seeded: record.seeded };
  } catch {
    return { kind: 'unusable' };
  }
}

export function serializeSeenFile(file: StampSeenFile): string {
  return JSON.stringify({ ids: [...file.ids].sort(), seeded: file.seeded });
}

type QualifiedStamp = { id: string; at: number };

function qualifiedStamps(stamps: readonly StampUnlockCandidate[]): QualifiedStamp[] {
  const byId = new Map<string, number>();
  for (const stamp of stamps) {
    if (!stamp.id) continue;
    if (stampKind(stamp.status) !== 'stamp') continue;
    if (!stamp.verifiedAt) continue;
    const at = new Date(stamp.verifiedAt).getTime();
    if (!Number.isFinite(at)) continue;
    const previous = byId.get(stamp.id);
    if (previous == null || at > previous) byId.set(stamp.id, at);
  }
  return [...byId.entries()].map(([id, at]) => ({ id, at }));
}

function olderThanWindow(verifiedAtMs: number, now: Date): boolean {
  return differenceInMilliseconds(now, new Date(verifiedAtMs)) > STAMP_UNLOCK_WINDOW_MS;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const seen = new Set(left);
  return right.every((id) => seen.has(id));
}

/**
 * Decide the one slam and the ids to remember.
 *
 * Before `seeded` is true, a stamp older than 24 hours is marked seen and
 * does not play. Stamps inside that window stay eligible. The window is an
 * absolute duration, so a Chicago calendar-day change does not age a stamp.
 * Among eligible unseen stamps, only the newest plays. The rest are marked
 * seen in the same write. `code_issued` never qualifies.
 */
export function planStampUnlock(input: {
  stamps: readonly StampUnlockCandidate[];
  now: Date;
  state: SeenState;
  reducedMotion: boolean;
  seedCatalog: boolean;
}): StampUnlockPlan {
  if (input.state.kind === 'unusable') return EMPTY_PLAN;

  const seeded = input.state.kind === 'ready' ? input.state.seeded : false;
  const seen = new Set(input.state.kind === 'ready' ? input.state.ids : []);
  const qualified = qualifiedStamps(input.stamps);

  if (!seeded) {
    for (const stamp of qualified) {
      if (olderThanWindow(stamp.at, input.now)) seen.add(stamp.id);
    }
  }

  const unseen = qualified
    .filter((stamp) => !seen.has(stamp.id))
    .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));

  for (const stamp of unseen) seen.add(stamp.id);

  const newest = unseen[0] ?? null;
  const nextSeeded = input.seedCatalog ? true : seeded;
  const ids = [...seen];
  const previousIds = input.state.kind === 'ready' ? input.state.ids : [];
  const changed = !sameIds(previousIds, ids) || nextSeeded !== seeded;

  return {
    slamId: newest && !input.reducedMotion ? newest.id : null,
    announceId: newest?.id ?? null,
    write: changed ? { ids, seeded: nextSeeded } : null,
  };
}

export function browserStampStorage(): StampUnlockStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function prefersReducedStampMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

/**
 * Read, decide, and write. A throw or unusable value returns no slam and
 * does not write. A throw on write also returns no slam.
 */
export function commitStampUnlock(input: {
  stamps: readonly StampUnlockCandidate[];
  now: Date;
  storage: StampUnlockStorage | null;
  reducedMotion: boolean;
  seedCatalog: boolean;
}): StampUnlockPlan {
  if (!input.storage) return EMPTY_PLAN;
  let raw: string | null;
  try {
    raw = input.storage.getItem(SEEN_STAMPS_STORAGE_KEY);
  } catch {
    return EMPTY_PLAN;
  }
  const state = readSeenState(raw);
  const plan = planStampUnlock({ ...input, state });
  if (!plan.write) return plan;
  try {
    input.storage.setItem(SEEN_STAMPS_STORAGE_KEY, serializeSeenFile(plan.write));
  } catch {
    return EMPTY_PLAN;
  }
  return plan;
}

const EMPTY_VIEW: Pick<StampUnlockPlan, 'slamId' | 'announceId'> = {
  slamId: null,
  announceId: null,
};

export function useStampUnlock(
  stamps: readonly StampUnlockCandidate[],
  seedCatalog: boolean,
): Pick<StampUnlockPlan, 'slamId' | 'announceId'> {
  const signature = stamps
    .map((stamp) => `${stamp.id}\t${stamp.status}\t${stamp.verifiedAt ?? ''}`)
    .join('\n');
  const [view, setView] = useState(EMPTY_VIEW);

  useEffect(() => {
    // After mount, so the server render and the first client paint match.
    // The timeout also lets Strict Mode cancel the first pass before it writes.
    const timer = window.setTimeout(() => {
      const plan = commitStampUnlock({
        stamps,
        now: new Date(),
        storage: browserStampStorage(),
        reducedMotion: prefersReducedStampMotion(),
        seedCatalog,
      });
      const shown = { slamId: plan.slamId, announceId: plan.announceId };
      setView((current) =>
        current.slamId === shown.slamId && current.announceId === shown.announceId ? current : shown,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [seedCatalog, signature, stamps]);

  return view;
}
