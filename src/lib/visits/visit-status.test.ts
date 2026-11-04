import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveVisitStatus,
  visitStatusCountsAsVisit,
  visitStatusLabel,
  type DeriveVisitStatusInput,
  type VisitStatus,
} from './visit-status';

const ROOT = path.resolve(__dirname, '../../..');

/** 11:59 PM America/Chicago on 2026-10-31. CDT (UTC-5); DST ends the next morning. */
const OCT_31_1159_CT = new Date('2026-11-01T04:59:00.000Z');
/** 12:01 AM America/Chicago on 2026-11-01. Still CDT. */
const NOV_1_1201_CT = new Date('2026-11-01T05:01:00.000Z');
const OPEN = '2026-12-01T00:00:00.000Z';
const FUTURE_CODE = '2026-12-01T00:15:00.000Z';

function chicagoParts(date: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
}

function input(overrides: Partial<DeriveVisitStatusInput> & Pick<DeriveVisitStatusInput, 'now'>): DeriveVisitStatusInput {
  return {
    item: { status: 'assigned', redemptionDeadline: OPEN },
    redemption: null,
    note: null,
    ...overrides,
  };
}

describe('deriveVisitStatus', () => {
  it('names the Chicago boundary instants without using the process timezone', () => {
    expect(chicagoParts(OCT_31_1159_CT)).toMatchObject({
      year: '2026',
      month: '10',
      day: '31',
      hour: '23',
      minute: '59',
    });
    expect(chicagoParts(NOV_1_1201_CT)).toMatchObject({
      year: '2026',
      month: '11',
      day: '1',
      hour: '00',
      minute: '01',
    });
  });

  it('is ready when an assigned item has no redemption and the window is open', () => {
    const status = deriveVisitStatus(input({ now: OCT_31_1159_CT }));
    expect(status).toBe('ready');
    expect(visitStatusCountsAsVisit(status)).toBe(false);
    expect(visitStatusLabel(status)).toBe('Ready');
  });

  it('is code_issued only while the issued code is still after now', () => {
    const status = deriveVisitStatus(
      input({
        now: OCT_31_1159_CT,
        item: { status: 'redeemed', redemptionDeadline: OPEN },
        redemption: {
          status: 'issued',
          verifiedAt: null,
          expiresAt: new Date(OCT_31_1159_CT.getTime() + 1).toISOString(),
        },
      }),
    );
    expect(status).toBe('code_issued');
    expect(visitStatusCountsAsVisit(status)).toBe(false);
  });

  it('treats expires_at equal to now as code_expired at both Chicago boundaries', () => {
    for (const now of [OCT_31_1159_CT, NOV_1_1201_CT]) {
      const status = deriveVisitStatus(
        input({
          now,
          item: { status: 'redeemed', redemptionDeadline: OPEN },
          redemption: {
            status: 'issued',
            verifiedAt: null,
            expiresAt: now.toISOString(),
          },
        }),
      );
      expect(status).toBe('code_expired');
      expect(visitStatusLabel(status)).toBe('Code expired. Get a new one');
      expect(visitStatusLabel(status)).not.toBe(visitStatusLabel('expired'));
      expect(visitStatusCountsAsVisit(status)).toBe(false);
    }
  });

  it('is code_expired when the redemption row is expired and the window is open', () => {
    const status = deriveVisitStatus(
      input({
        now: NOV_1_1201_CT,
        item: { status: 'redeemed', redemptionDeadline: OPEN },
        redemption: {
          status: 'expired',
          verifiedAt: null,
          expiresAt: OCT_31_1159_CT.toISOString(),
        },
      }),
    );
    expect(status).toBe('code_expired');
  });

  it('closes the visit when the window ends before the code TTL', () => {
    const now = NOV_1_1201_CT;
    const status = deriveVisitStatus(
      input({
        now,
        item: {
          status: 'redeemed',
          redemptionDeadline: OCT_31_1159_CT.toISOString(),
        },
        redemption: {
          status: 'issued',
          verifiedAt: null,
          expiresAt: FUTURE_CODE,
        },
      }),
    );
    expect(status).toBe('expired');
    expect(visitStatusLabel(status)).toBe('This adventure is no longer active.');
    expect(visitStatusCountsAsVisit(status)).toBe(false);
  });

  it('is expired when the deadline equals now or the item status is expired', () => {
    expect(
      deriveVisitStatus(
        input({
          now: NOV_1_1201_CT,
          item: { status: 'assigned', redemptionDeadline: NOV_1_1201_CT.toISOString() },
        }),
      ),
    ).toBe('expired');
    expect(
      deriveVisitStatus(
        input({
          now: OCT_31_1159_CT,
          item: { status: 'expired', redemptionDeadline: OPEN },
        }),
      ),
    ).toBe('expired');
  });

  it('keeps a null visit window open', () => {
    expect(
      deriveVisitStatus(
        input({
          now: NOV_1_1201_CT,
          item: { status: 'assigned', redemptionDeadline: null },
        }),
      ),
    ).toBe('ready');
  });

  it('lets a verified redemption win over a closed window, item expiry, and the code clock', () => {
    const cases: DeriveVisitStatusInput[] = [
      input({
        now: NOV_1_1201_CT,
        item: { status: 'expired', redemptionDeadline: OCT_31_1159_CT.toISOString() },
        redemption: {
          status: 'verified',
          verifiedAt: '2026-10-02T15:00:00.000Z',
          expiresAt: OCT_31_1159_CT.toISOString(),
        },
      }),
      input({
        now: NOV_1_1201_CT,
        item: { status: 'swapped_out', redemptionDeadline: OCT_31_1159_CT.toISOString() },
        redemption: {
          status: 'verified',
          verifiedAt: '2026-10-02T15:00:00.000Z',
          expiresAt: OCT_31_1159_CT.toISOString(),
        },
      }),
    ];
    for (const row of cases) {
      const status = deriveVisitStatus(row);
      expect(status).toBe('verified');
      expect(visitStatusCountsAsVisit(status)).toBe(true);
    }
  });

  it('is note_added only when the verified visit has a bite note row', () => {
    const verified = {
      status: 'verified',
      verifiedAt: '2026-10-02T15:00:00.000Z',
      expiresAt: OCT_31_1159_CT.toISOString(),
    };
    expect(
      deriveVisitStatus(
        input({
          now: NOV_1_1201_CT,
          item: { status: 'expired', redemptionDeadline: OCT_31_1159_CT.toISOString() },
          redemption: verified,
          note: { note: null },
        }),
      ),
    ).toBe('note_added');
    expect(
      deriveVisitStatus(
        input({
          now: OCT_31_1159_CT,
          item: { status: 'redeemed', redemptionDeadline: OPEN },
          redemption: {
            status: 'issued',
            verifiedAt: null,
            expiresAt: FUTURE_CODE,
          },
          note: { note: 'Loved it' },
        }),
      ),
    ).toBe('code_issued');
  });

  it('is swapped for a swapped-out item and never counts it', () => {
    const status = deriveVisitStatus(
      input({
        now: OCT_31_1159_CT,
        item: { status: 'swapped_out', redemptionDeadline: OPEN },
        redemption: {
          status: 'issued',
          verifiedAt: null,
          expiresAt: FUTURE_CODE,
        },
      }),
    );
    expect(status).toBe('swapped');
    expect(visitStatusCountsAsVisit(status)).toBe(false);
    expect(visitStatusLabel(status)).toBe('Swapped');
  });

  it('returns the same status for the same facts at both boundaries', () => {
    const facts = {
      item: { status: 'redeemed', redemptionDeadline: OPEN },
      redemption: {
        status: 'issued',
        verifiedAt: null,
        expiresAt: OCT_31_1159_CT.toISOString(),
      },
      note: null,
    };
    const atNight = deriveVisitStatus({ ...facts, now: OCT_31_1159_CT });
    const afterMidnight = deriveVisitStatus({
      ...facts,
      now: NOV_1_1201_CT,
      redemption: {
        status: 'issued',
        verifiedAt: null,
        expiresAt: NOV_1_1201_CT.toISOString(),
      },
    });
    expect(atNight).toBe<VisitStatus>('code_expired');
    expect(afterMidnight).toBe(atNight);
  });
});

describe('visit status loaders', () => {
  it('derives status in the challenge, visit, code, and progress reads', () => {
    const files = [
      'src/lib/challenges/generate.ts',
      'src/lib/challenges/carried-credits.ts',
      'src/components/passport/passport-content.tsx',
      'src/components/journal/journal-content.tsx',
      'src/app/actions/get-user-stats.ts',
      'src/components/challenges/show-redemption-code.tsx',
      'src/lib/progress/get-member-progress.ts',
    ];
    for (const file of files) {
      expect(readFileSync(path.join(ROOT, file), 'utf8')).toContain('deriveVisitStatus');
    }
    const progress = readFileSync(path.join(ROOT, 'src/lib/progress/get-member-progress.ts'), 'utf8');
    expect(progress).toContain('visitStatusCountsAsVisit');
    expect(progress).not.toContain('.insert(');
    expect(progress).not.toContain('.update(');
    expect(progress).not.toContain('.upsert(');
    expect(progress).not.toContain('.delete(');
  });
});
