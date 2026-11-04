import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chicagoVisitDate } from '@/lib/passport/passport-board';
import {
  commitStampUnlock,
  planStampUnlock,
  readSeenState,
  SEEN_STAMPS_STORAGE_KEY,
  serializeSeenFile,
  type StampSeenFile,
  type StampUnlockCandidate,
  type StampUnlockStorage,
  type SeenState,
} from '@/lib/passport/stamp-unlock';

const OCT_31 = '2026-11-01T04:30:00.000Z';
const NOON_NOV_1 = new Date('2026-11-01T16:30:00.000Z');
const EXACT_24H = new Date('2026-11-02T04:30:00.000Z');
const PAST_24H = new Date('2026-11-02T04:30:00.001Z');

function stamp(
  id: string,
  status: StampUnlockCandidate['status'],
  verifiedAt: string | null,
): StampUnlockCandidate {
  return { id, status, verifiedAt };
}

function memoryStorage(initial: string | null = null, fail: 'get' | 'set' | null = null): StampUnlockStorage & {
  raw: () => string | null;
} {
  let value = initial;
  return {
    getItem(key: string) {
      if (fail === 'get') throw new Error('storage blocked');
      if (key !== SEEN_STAMPS_STORAGE_KEY) return null;
      return value;
    },
    setItem(key: string, next: string) {
      if (fail === 'set') throw new Error('storage blocked');
      if (key !== SEEN_STAMPS_STORAGE_KEY) return;
      value = next;
    },
    raw: () => value,
  };
}

function ready(file: StampSeenFile): SeenState {
  return { kind: 'ready', ids: file.ids, seeded: file.seeded };
}

describe('stamp unlock', () => {
  it('parses a seen file and rejects junk', () => {
    expect(readSeenState(null)).toEqual({ kind: 'missing' });
    expect(readSeenState(serializeSeenFile({ ids: ['b', 'a'], seeded: true }))).toEqual({
      kind: 'ready',
      ids: ['a', 'b'],
      seeded: true,
    });
    for (const junk of ['', '[]', 'null', '{', '{"ids":[1],"seeded":true}', '{"ids":["ok"]}', '{"seeded":true}', '{"ids":[""],"seeded":false}']) {
      expect(readSeenState(junk)).toEqual({ kind: 'unusable' });
    }
  });

  it('slams one unseen verified stamp and stores its id', () => {
    const storage = memoryStorage();
    const plan = commitStampUnlock({
      stamps: [stamp('red-new', 'verified', NOON_NOV_1.toISOString())],
      now: NOON_NOV_1,
      storage,
      reducedMotion: false,
      seedCatalog: true,
    });
    expect(plan.slamId).toBe('red-new');
    expect(plan.announceId).toBe('red-new');
    expect(JSON.parse(storage.raw() ?? '')).toEqual({ ids: ['red-new'], seeded: true });

    const again = commitStampUnlock({
      stamps: [stamp('red-new', 'verified', NOON_NOV_1.toISOString())],
      now: NOON_NOV_1,
      storage,
      reducedMotion: false,
      seedCatalog: true,
    });
    expect(again.slamId).toBeNull();
    expect(again.announceId).toBeNull();
    expect(again.write).toBeNull();
  });

  it('slams only the newest of three unseen stamps and marks all three seen', () => {
    const plan = planStampUnlock({
      stamps: [
        stamp('older', 'verified', '2026-11-01T12:00:00.000Z'),
        stamp('newest', 'note_added', '2026-11-01T15:00:00.000Z'),
        stamp('middle', 'verified', '2026-11-01T14:00:00.000Z'),
      ],
      now: NOON_NOV_1,
      state: ready({ ids: [], seeded: true }),
      reducedMotion: false,
      seedCatalog: true,
    });
    expect(plan.slamId).toBe('newest');
    expect(plan.write?.ids.sort()).toEqual(['middle', 'newest', 'older']);
    expect(plan.write?.seeded).toBe(true);
  });

  it('breaks a verified_at tie by id descending', () => {
    const plan = planStampUnlock({
      stamps: [
        stamp('a-id', 'verified', '2026-11-01T15:00:00.000Z'),
        stamp('b-id', 'verified', '2026-11-01T15:00:00.000Z'),
      ],
      now: NOON_NOV_1,
      state: ready({ ids: [], seeded: true }),
      reducedMotion: false,
      seedCatalog: true,
    });
    expect(plan.slamId).toBe('b-id');
  });

  it('never animates or stores a pending code_issued stamp', () => {
    const storage = memoryStorage();
    const plan = commitStampUnlock({
      stamps: [stamp('pending', 'code_issued', NOON_NOV_1.toISOString())],
      now: NOON_NOV_1,
      storage,
      reducedMotion: false,
      seedCatalog: true,
    });
    expect(plan.slamId).toBeNull();
    expect(plan.announceId).toBeNull();
    const saved = JSON.parse(storage.raw() ?? '') as StampSeenFile;
    expect(saved.ids).toEqual([]);
    expect(saved.seeded).toBe(true);
    expect(saved.ids).not.toContain('pending');
  });

  it('leaves a verified stamp with no verified_at unseen and unplayed', () => {
    const plan = planStampUnlock({
      stamps: [stamp('blank', 'verified', null), stamp('bad', 'note_added', 'not-a-time')],
      now: NOON_NOV_1,
      state: { kind: 'missing' },
      reducedMotion: false,
      seedCatalog: false,
    });
    expect(plan).toEqual({ slamId: null, announceId: null, write: null });
  });

  it('renders no slam when storage throws or holds junk', () => {
    const junk = memoryStorage('{');
    expect(() =>
      commitStampUnlock({
        stamps: [stamp('red-new', 'verified', NOON_NOV_1.toISOString())],
        now: NOON_NOV_1,
        storage: junk,
        reducedMotion: false,
        seedCatalog: true,
      }),
    ).not.toThrow();
    expect(
      commitStampUnlock({
        stamps: [stamp('red-new', 'verified', NOON_NOV_1.toISOString())],
        now: NOON_NOV_1,
        storage: junk,
        reducedMotion: false,
        seedCatalog: true,
      }),
    ).toEqual({ slamId: null, announceId: null, write: null });
    expect(junk.raw()).toBe('{');

    const blocked = memoryStorage(null, 'get');
    expect(
      commitStampUnlock({
        stamps: [stamp('red-new', 'verified', NOON_NOV_1.toISOString())],
        now: NOON_NOV_1,
        storage: blocked,
        reducedMotion: false,
        seedCatalog: true,
      }).slamId,
    ).toBeNull();

    const writeFails = memoryStorage(null, 'set');
    expect(
      commitStampUnlock({
        stamps: [stamp('red-new', 'verified', NOON_NOV_1.toISOString())],
        now: NOON_NOV_1,
        storage: writeFails,
        reducedMotion: false,
        seedCatalog: true,
      }),
    ).toEqual({ slamId: null, announceId: null, write: null });
    expect(writeFails.raw()).toBeNull();
  });

  it('is safe when there is no storage, including SSR', () => {
    expect(
      commitStampUnlock({
        stamps: [stamp('red-new', 'verified', NOON_NOV_1.toISOString())],
        now: NOON_NOV_1,
        storage: null,
        reducedMotion: false,
        seedCatalog: true,
      }),
    ).toEqual({ slamId: null, announceId: null, write: null });
  });

  it('marks a reduced-motion stamp seen without a slam', () => {
    const plan = planStampUnlock({
      stamps: [stamp('red-new', 'verified', NOON_NOV_1.toISOString())],
      now: NOON_NOV_1,
      state: { kind: 'missing' },
      reducedMotion: true,
      seedCatalog: true,
    });
    expect(plan.slamId).toBeNull();
    expect(plan.announceId).toBe('red-new');
    expect(plan.write).toEqual({ ids: ['red-new'], seeded: true });
  });

  it('seeds only stamps older than 24h on the first passport run', () => {
    const old = planStampUnlock({
      stamps: [stamp('old', 'verified', '2026-04-26T18:00:00.000Z')],
      now: NOON_NOV_1,
      state: { kind: 'missing' },
      reducedMotion: false,
      seedCatalog: true,
    });
    expect(old.slamId).toBeNull();
    expect(old.announceId).toBeNull();
    expect(old.write).toEqual({ ids: ['old'], seeded: true });

    const exact = planStampUnlock({
      stamps: [stamp('exact', 'verified', OCT_31)],
      now: EXACT_24H,
      state: { kind: 'missing' },
      reducedMotion: false,
      seedCatalog: true,
    });
    expect(exact.slamId).toBe('exact');

    const past = planStampUnlock({
      stamps: [stamp('past', 'verified', OCT_31)],
      now: PAST_24H,
      state: { kind: 'missing' },
      reducedMotion: false,
      seedCatalog: true,
    });
    expect(past.slamId).toBeNull();
    expect(past.write?.ids).toEqual(['past']);
  });

  it('keeps 2026-11-01T04:30:00Z inside the window at Chicago noon on Nov 1', () => {
    expect(chicagoVisitDate(OCT_31)?.long).toBe('October 31, 2026');
    expect(chicagoVisitDate(NOON_NOV_1.toISOString())?.long).toBe('November 1, 2026');
    const plan = planStampUnlock({
      stamps: [
        stamp('oct31', 'verified', OCT_31),
        stamp('older', 'note_added', '2026-04-26T18:00:00.000Z'),
      ],
      now: NOON_NOV_1,
      state: { kind: 'missing' },
      reducedMotion: false,
      seedCatalog: true,
    });
    expect(plan.slamId).toBe('oct31');
    expect(plan.announceId).toBe('oct31');
    expect(plan.write?.ids.sort()).toEqual(['oct31', 'older']);
    expect(plan.write?.seeded).toBe(true);
  });

  it('lets the redemption screen mark one id without skipping the passport seed', () => {
    const storage = memoryStorage();
    const onRedemption = commitStampUnlock({
      stamps: [stamp('fresh', 'verified', NOON_NOV_1.toISOString())],
      now: NOON_NOV_1,
      storage,
      reducedMotion: false,
      seedCatalog: false,
    });
    expect(onRedemption.slamId).toBe('fresh');
    expect(JSON.parse(storage.raw() ?? '')).toEqual({ ids: ['fresh'], seeded: false });

    const onPassport = commitStampUnlock({
      stamps: [
        stamp('fresh', 'verified', NOON_NOV_1.toISOString()),
        stamp('old', 'verified', '2026-04-26T18:00:00.000Z'),
        stamp('pending', 'code_issued', null),
      ],
      now: NOON_NOV_1,
      storage,
      reducedMotion: false,
      seedCatalog: true,
    });
    expect(onPassport.slamId).toBeNull();
    const saved = JSON.parse(storage.raw() ?? '') as StampSeenFile;
    expect(saved.seeded).toBe(true);
    expect(saved.ids.sort()).toEqual(['fresh', 'old']);
    expect(saved.ids).not.toContain('pending');
  });

  it('does not hardcode the slam landing angle at 5 degrees', () => {
    const css = readFileSync(
      path.resolve(__dirname, '../../app/styles/wanderbite-theme.css'),
      'utf8',
    );
    const keyframes = css.slice(css.indexOf('@keyframes wb-stamp'), css.indexOf('@keyframes wb-ink-burst'));
    expect(keyframes).toContain('rotate(-23deg)');
    expect(keyframes).toContain('rotate(1deg)');
    expect(keyframes).toContain('rotate(0deg)');
    expect(keyframes).not.toContain('rotate(5deg)');
    expect(keyframes).not.toContain('rotate(-18deg)');
    expect(css).toContain('.wb-ink-burst');
    expect(css).toContain('.wb-ink-burst { opacity: 0 !important; }');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced.indexOf('.wb-stamp-slam')).toBeGreaterThan(-1);
    expect(reduced.indexOf('.wb-ink-burst')).toBeGreaterThan(reduced.indexOf('.wb-stamp-slam'));
  });
});
