import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_PRIZE_MARKER, campaignWindow } from '@/lib/drawings/campaign';
import { campaignWindowLabel } from '@/lib/drawings/campaign-editor';
import {
  MEMBER_DRAWING_CAMPAIGN_COLUMNS,
  MEMBER_DRAWING_PRIZE_COLUMNS,
  MEMBER_DRAWING_SELECTION_COLUMNS,
  MEMBER_DRAWING_WINNER_COLUMNS,
  loadMemberSampleDrawing,
  mapMemberSampleDrawing,
  type MemberDrawingClient,
  type MemberDrawingSession,
  type MemberSampleDrawingRows,
} from '@/lib/drawings/member-drawing-read-model';

const ROOT = path.resolve(__dirname, '../../..');

const SELF = '11111111-1111-4111-8111-111111111111';
const OTHER = '9f3c1a20-7b6e-4d11-8a55-0c0ffee00001';
const SEED = 'ab'.repeat(32);
const ENTRY_ID = 'entry-foreign-0001';
const RUN_BY = 'operator-label-secret';
const EMAIL = 'other.member@example.com';
const COST = 424242;
const SECRET = 'member-a@example.com bearer-token-secret';

const Q1_NOW = '2027-02-15T18:00:00.000Z';
const Q4_EDGE = '2026-12-31T23:30:00-06:00';
const Q1_START = '2027-01-01T06:00:00.000Z';

const { getSupabaseAdmin } = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(() => {
    throw new Error('service-role-should-not-run');
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

const windowQ1 = campaignWindow('2027-Q1');
const windowQ4 = campaignWindow('2026-Q4');
if (!windowQ1 || !windowQ4) throw new Error('quarter window missing');

type Recorded = {
  table: string;
  columns: string;
  eqs: [string, string][];
  ins: [string, string[]][];
};

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 'camp-active',
    quarter_key: '2027-Q1',
    mode: 'sample',
    status: 'active',
    starts_at: windowQ1?.startsAt,
    ends_at: windowQ1?.endsAt,
    seed: SEED,
    run_by: RUN_BY,
    email: EMAIL,
    ...overrides,
  };
}

function prize(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prize-dinner',
    campaign_id: 'camp-active',
    label: 'Sample prize: Dinner for two',
    quantity: 2,
    unit_value_cents: 4000,
    position: 0,
    actual_cost_cents: COST,
    fulfillment_status: 'forfeited',
    ...overrides,
  };
}

function rows(overrides: Partial<MemberSampleDrawingRows> = {}): MemberSampleDrawingRows {
  return {
    now: Q1_NOW,
    campaigns: [campaign()],
    prizes: [prize()],
    selections: [],
    winners: [],
    entriesByQuarter: [
      { quarterKey: '2026-Q4', count: 9 },
      { quarterKey: '2027-Q1', count: 3 },
    ],
    memberUserId: SELF,
    ...overrides,
  };
}

function session(id: string | null, thrown = false): MemberDrawingSession {
  return {
    auth: {
      async getUser() {
        if (thrown) throw new Error(SECRET);
        return { data: { user: id ? { id } : null }, error: null };
      },
    },
  };
}

function fakeAdmin(respond: (call: Recorded) => { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: Recorded[] = [];
  const client: MemberDrawingClient = {
    from(table) {
      return {
        select(columns) {
          const call: Recorded = { table, columns, eqs: [], ins: [] };
          calls.push(call);
          const filter = {
            eq(column: string, value: string) {
              call.eqs.push([column, value]);
              return filter;
            },
            in(column: string, values: readonly string[]) {
              call.ins.push([column, [...values]]);
              return filter;
            },
            order() {
              return filter;
            },
            async range() {
              return respond(call);
            },
          };
          return filter;
        },
      };
    },
  };
  return { client, calls };
}

const FOREIGN = [SELF, OTHER, SEED, ENTRY_ID, RUN_BY, EMAIL, String(COST), 'forfeited', 'rank', 'run_by'];

function expectNoForeign(value: unknown) {
  const encoded = JSON.stringify(value);
  for (const secret of FOREIGN) {
    expect(encoded).not.toContain(secret);
  }
}

describe('mapMemberSampleDrawing', () => {
  it('returns none when the quarter has no campaign', () => {
    expect(mapMemberSampleDrawing(rows({ campaigns: [] }))).toEqual({ kind: 'none' });
  });

  it('shows the active sample campaign, stored dates, prize, and entry count', () => {
    const view = mapMemberSampleDrawing(rows());
    expect(view).toMatchObject({
      kind: 'campaign',
      quarterKey: '2027-Q1',
      startsOn: 'Jan 1, 2027',
      endsOn: 'Mar 31, 2027',
      status: 'active',
      entryCount: 3,
      result: 'not_drawn',
      prizes: [{ label: 'Sample prize: Dinner for two', quantity: 2, sampleValueCents: 4000 }],
    });
    if (view.kind === 'campaign') {
      expect(`${view.startsOn} \u2013 ${view.endsOn}`).toBe(campaignWindowLabel('2027-Q1'));
      expect(view.pickedPrizeLabel).toBeUndefined();
      for (const prizeRow of view.prizes) {
        expect(prizeRow.label).toContain(SAMPLE_PRIZE_MARKER);
      }
    }
    expectNoForeign(view);
  });

  it('says the drawing has not been run when a closed campaign has no selection', () => {
    const view = mapMemberSampleDrawing(
      rows({ campaigns: [campaign({ id: 'camp-closed', status: 'closed' })], prizes: [prize({ campaign_id: 'camp-closed' })] }),
    );
    expect(view).toMatchObject({ kind: 'campaign', status: 'closed', result: 'not_drawn' });
    expectNoForeign(view);
  });

  it('names the simulated prize when this member was picked', () => {
    const view = mapMemberSampleDrawing(
      rows({
        campaigns: [campaign({ status: 'closed' })],
        selections: [
          {
            id: 'selection-1',
            campaign_id: 'camp-active',
            seed: SEED,
            run_by: RUN_BY,
            eligible_user_ids: [OTHER, SELF],
          },
        ],
        winners: [
          {
            campaign_id: 'camp-active',
            prize_id: 'prize-dinner',
            user_id: OTHER,
            rank: 4,
            entry_id: ENTRY_ID,
            actual_cost_cents: COST,
            fulfillment_status: 'forfeited',
          },
          {
            campaign_id: 'camp-active',
            prize_id: 'prize-dinner',
            user_id: SELF,
            rank: 8,
            entry_id: 'entry-self',
            actual_cost_cents: COST,
            fulfillment_status: 'forfeited',
          },
        ],
      }),
    );
    expect(view).toMatchObject({
      kind: 'campaign',
      result: 'picked',
      pickedPrizeLabel: 'Sample prize: Dinner for two',
    });
    expect(Object.keys(view).sort()).toEqual(
      [
        'endsOn',
        'entryCount',
        'kind',
        'pickedPrizeLabel',
        'prizes',
        'quarterKey',
        'result',
        'startsOn',
        'status',
      ].sort(),
    );
    expectNoForeign(view);
  });

  it('says this member was not picked when a selection exists without their row', () => {
    const view = mapMemberSampleDrawing(
      rows({
        selections: [{ id: 'selection-1', campaign_id: 'camp-active', seed: SEED, run_by: RUN_BY }],
        winners: [
          {
            campaign_id: 'camp-active',
            prize_id: 'prize-dinner',
            user_id: OTHER,
            rank: 2,
            entry_id: ENTRY_ID,
            email: EMAIL,
          },
        ],
      }),
    );
    expect(view).toMatchObject({ kind: 'campaign', result: 'not_picked' });
    if (view.kind === 'campaign') expect(view.pickedPrizeLabel).toBeUndefined();
    expectNoForeign(view);
  });

  it('shows nothing for a draft sample campaign or any live campaign', () => {
    expect(
      mapMemberSampleDrawing(rows({ campaigns: [campaign({ status: 'draft' })] })),
    ).toEqual({ kind: 'none' });
    expect(
      mapMemberSampleDrawing(rows({ campaigns: [campaign({ mode: 'live', status: 'active', id: 'live-1' })] })),
    ).toEqual({ kind: 'none' });
    expect(
      mapMemberSampleDrawing(
        rows({
          campaigns: [
            campaign({ id: 'live-draft', mode: 'live', status: 'draft' }),
            campaign({ id: 'sample-draft', status: 'draft' }),
          ],
        }),
      ),
    ).toEqual({ kind: 'none' });
  });

  it('prefers the active sample campaign when a closed one exists for the same quarter', () => {
    const view = mapMemberSampleDrawing(
      rows({
        campaigns: [
          campaign({ id: 'camp-closed', status: 'closed' }),
          campaign({ id: 'camp-active', status: 'active' }),
        ],
        prizes: [
          prize({ id: 'closed-prize', campaign_id: 'camp-closed', label: 'Sample prize: Closed gift' }),
          prize(),
        ],
        selections: [{ id: 'selection-closed', campaign_id: 'camp-closed' }],
        winners: [{ campaign_id: 'camp-closed', prize_id: 'closed-prize', user_id: SELF }],
      }),
    );
    expect(view).toMatchObject({
      kind: 'campaign',
      status: 'active',
      result: 'not_drawn',
      prizes: [{ label: 'Sample prize: Dinner for two' }],
    });
  });

  it('keeps Sample prize on every label, including a stored label that omitted it', () => {
    const view = mapMemberSampleDrawing(
      rows({
        prizes: [
          prize({ label: 'Dinner for two' }),
          prize({
            id: 'prize-gift',
            label: 'Gift card',
            quantity: '1',
            unit_value_cents: '1500',
            position: '1',
          }),
        ],
      }),
    );
    expect(view).toMatchObject({
      kind: 'campaign',
      prizes: [
        { label: 'Sample prize: Dinner for two', quantity: 2, sampleValueCents: 4000 },
        { label: 'Sample prize: Gift card', quantity: 1, sampleValueCents: 1500 },
      ],
    });
    if (view.kind === 'campaign') {
      for (const row of view.prizes) expect(row.label).toContain('Sample prize');
    }
  });

  it('counts the stored quarter key and ignores another quarter', () => {
    const view = mapMemberSampleDrawing(
      rows({
        entriesByQuarter: [
          { quarterKey: '2026-Q4', count: 9 },
          { quarterKey: '2027-Q1', count: 3 },
        ],
      }),
    );
    expect(view).toMatchObject({ kind: 'campaign', entryCount: 3, quarterKey: '2027-Q1' });
  });

  it('uses the Chicago quarter at the year boundary', () => {
    const q4 = mapMemberSampleDrawing(
      rows({
        now: Q4_EDGE,
        campaigns: [
          campaign({
            id: 'q4',
            quarter_key: '2026-Q4',
            starts_at: windowQ4?.startsAt,
            ends_at: windowQ4?.endsAt,
          }),
          campaign(),
        ],
        prizes: [prize({ campaign_id: 'q4' })],
      }),
    );
    const q1 = mapMemberSampleDrawing(rows({ now: Q1_START }));
    expect(q4).toMatchObject({ kind: 'campaign', quarterKey: '2026-Q4', startsOn: 'Oct 1, 2026', endsOn: 'Dec 31, 2026' });
    expect(q1).toMatchObject({ kind: 'campaign', quarterKey: '2027-Q1' });
  });

  it('returns unavailable when a row cannot be read or the clock is not a time', () => {
    expect(mapMemberSampleDrawing(rows({ now: 'not-a-date' }))).toEqual({ kind: 'unavailable' });
    expect(mapMemberSampleDrawing(rows({ campaigns: [campaign({ mode: 'mystery' })] }))).toEqual({
      kind: 'unavailable',
    });
    expect(mapMemberSampleDrawing(rows({ prizes: [prize({ quantity: 0 })] }))).toEqual({ kind: 'unavailable' });
  });
});

describe('loadMemberSampleDrawing', () => {
  afterEach(() => {
    getSupabaseAdmin.mockClear();
  });

  it('does not call the service-role client when the session is signed out or is a different member', async () => {
    const signedOut = fakeAdmin(() => ({ data: [], error: null }));
    await expect(
      loadMemberSampleDrawing({
        userId: SELF,
        now: new Date(Q1_NOW),
        entriesByQuarter: [],
        session: session(null),
        admin: signedOut.client,
      }),
    ).resolves.toEqual({ kind: 'none' });
    expect(signedOut.calls).toEqual([]);

    const mismatch = fakeAdmin(() => ({ data: [], error: null }));
    await expect(
      loadMemberSampleDrawing({
        userId: SELF,
        now: new Date(Q1_NOW),
        entriesByQuarter: [],
        session: session(OTHER),
        admin: mismatch.client,
      }),
    ).resolves.toEqual({ kind: 'none' });
    expect(mismatch.calls).toEqual([]);
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('does not construct the service-role client when no admin client is passed and the session is signed out', async () => {
    await expect(
      loadMemberSampleDrawing({
        userId: SELF,
        now: new Date(Q1_NOW),
        entriesByQuarter: [],
        session: session(null),
      }),
    ).resolves.toEqual({ kind: 'none' });
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('returns unavailable and does not log when the session read throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const admin = fakeAdmin(() => ({ data: [], error: null }));
    await expect(
      loadMemberSampleDrawing({
        userId: SELF,
        now: new Date(Q1_NOW),
        entriesByQuarter: [],
        session: session(SELF, true),
        admin: admin.client,
      }),
    ).resolves.toEqual({ kind: 'unavailable' });
    expect(admin.calls).toEqual([]);
    const logged = [...errorSpy.mock.calls, ...logSpy.mock.calls].flat().join('\n');
    expect(logged).not.toContain(SECRET);
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('returns unavailable when the drawing tables are missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const admin = fakeAdmin(() => ({
      data: null,
      error: { code: '42P01', message: `relation "drawing_campaigns" does not exist ${SECRET}` },
    }));
    await expect(
      loadMemberSampleDrawing({
        userId: SELF,
        now: new Date(Q1_NOW),
        entriesByQuarter: [{ quarterKey: '2027-Q1', count: 3 }],
        session: session(SELF),
        admin: admin.client,
      }),
    ).resolves.toEqual({ kind: 'unavailable' });
    expect(admin.calls.map((call) => call.table)).toEqual(['drawing_campaigns']);
    expect(errorSpy.mock.calls.flat().join('\n')).not.toContain(SECRET);
    errorSpy.mockRestore();
  });

  it('returns unavailable and does not log when the read throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client: MemberDrawingClient = {
      from() {
        throw new Error(SECRET);
      },
    };
    await expect(
      loadMemberSampleDrawing({
        userId: SELF,
        now: new Date(Q1_NOW),
        entriesByQuarter: [],
        session: session(SELF),
        admin: client,
      }),
    ).resolves.toEqual({ kind: 'unavailable' });
    expect(errorSpy.mock.calls.flat().join('\n')).not.toContain(SECRET);
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not read prizes or winners for a draft-only or live-only quarter', async () => {
    for (const stored of [
      campaign({ status: 'draft' }),
      campaign({ mode: 'live', status: 'active' }),
    ]) {
      const admin = fakeAdmin((call) =>
        call.table === 'drawing_campaigns' ? { data: [stored], error: null } : { data: [], error: null },
      );
      await expect(
        loadMemberSampleDrawing({
          userId: SELF,
          now: new Date(Q1_NOW),
          entriesByQuarter: [{ quarterKey: '2027-Q1', count: 3 }],
          session: session(SELF),
          admin: admin.client,
        }),
      ).resolves.toEqual({ kind: 'none' });
      expect(admin.calls.map((call) => call.table)).toEqual(['drawing_campaigns']);
    }
  });

  it('reads only this member and does not select seed, rank, entry id, or fulfillment', async () => {
    const admin = fakeAdmin((call) => {
      if (call.table === 'drawing_campaigns') return { data: [campaign({ status: 'closed' })], error: null };
      if (call.table === 'drawing_campaign_prizes') return { data: [prize()], error: null };
      if (call.table === 'drawing_selections') {
        return { data: [{ id: 'selection-1', campaign_id: 'camp-active' }], error: null };
      }
      if (call.table === 'drawing_selection_winners') {
        return {
          data: [{ campaign_id: 'camp-active', prize_id: 'prize-dinner', user_id: SELF }],
          error: null,
        };
      }
      throw new Error(`unexpected table ${call.table}`);
    });
    const view = await loadMemberSampleDrawing({
      userId: SELF,
      now: new Date(Q1_NOW),
      entriesByQuarter: [{ quarterKey: '2027-Q1', count: 3 }],
      session: session(SELF),
      admin: admin.client,
    });
    expect(view).toMatchObject({
      kind: 'campaign',
      result: 'picked',
      pickedPrizeLabel: 'Sample prize: Dinner for two',
      entryCount: 3,
    });
    expectNoForeign(view);
    expect(admin.calls.map((call) => call.table)).toEqual([
      'drawing_campaigns',
      'drawing_campaign_prizes',
      'drawing_selections',
      'drawing_selection_winners',
    ]);
    const campaignCall = admin.calls[0];
    expect(campaignCall?.columns).toBe(MEMBER_DRAWING_CAMPAIGN_COLUMNS);
    expect(campaignCall?.eqs).toEqual([['quarter_key', '2027-Q1']]);
    expect(admin.calls[1]?.columns).toBe(MEMBER_DRAWING_PRIZE_COLUMNS);
    expect(admin.calls[2]?.columns).toBe(MEMBER_DRAWING_SELECTION_COLUMNS);
    const winners = admin.calls[3];
    expect(winners?.columns).toBe(MEMBER_DRAWING_WINNER_COLUMNS);
    expect(winners?.eqs).toEqual([['user_id', SELF]]);
    expect(winners?.ins).toEqual([['campaign_id', ['camp-active']]]);
    expect(winners?.columns).not.toMatch(/rank|entry_id|seed|run_by|actual_cost/);
    expect(admin.calls.some((call) => call.table === 'drawing_fulfillments')).toBe(false);
  });

  it('does not name fulfillment columns in the selects', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/drawings/member-drawing-read-model.ts'), 'utf8');
    expect(source.startsWith("import 'server-only';")).toBe(true);
    expect(source).not.toContain('drawing_fulfillments');
    expect(MEMBER_DRAWING_SELECTION_COLUMNS).not.toMatch(/seed|run_by|eligible_/);
    expect(MEMBER_DRAWING_WINNER_COLUMNS).not.toMatch(/rank|entry_id/);
    expect(MEMBER_DRAWING_CAMPAIGN_COLUMNS).not.toMatch(/total_budget|fulfillment_allowance|rules_version/);
  });
});

describe('member sample drawing quarter under TZ=UTC and TZ=America/Chicago', () => {
  it('keeps 2026-Q4 and 2027-Q1 on the Chicago calendar in both process time zones', () => {
    const tsx = path.join(ROOT, 'node_modules', '.bin', 'tsx');
    const script = [
      "const Module = require('node:module');",
      'const originalLoad = Module._load;',
      'Module._load = function (request, parent, isMain) {',
      "  if (request === 'server-only') return {};",
      '  return originalLoad.apply(this, arguments);',
      '};',
      "const { campaignWindow } = require('./src/lib/drawings/campaign.ts');",
      "const { mapMemberSampleDrawing } = require('./src/lib/drawings/member-drawing-read-model.ts');",
      'function viewFor(now) {',
      "  const q4 = campaignWindow('2026-Q4');",
      "  const q1 = campaignWindow('2027-Q1');",
      '  return mapMemberSampleDrawing({',
      '    now,',
      "    memberUserId: 'member-1',",
      "    entriesByQuarter: [{ quarterKey: '2026-Q4', count: 1 }, { quarterKey: '2027-Q1', count: 3 }],",
      '    prizes: [],',
      '    selections: [],',
      '    winners: [],',
      '    campaigns: [',
      "      { id: 'q4', quarter_key: '2026-Q4', mode: 'sample', status: 'active', starts_at: q4.startsAt, ends_at: q4.endsAt },",
      "      { id: 'q1', quarter_key: '2027-Q1', mode: 'sample', status: 'active', starts_at: q1.startsAt, ends_at: q1.endsAt },",
      '    ],',
      '  });',
      '}',
      "const edge = viewFor('2026-12-31T23:30:00-06:00');",
      "const next = viewFor('2027-01-01T06:00:00Z');",
      'process.stdout.write(JSON.stringify({',
      "  edge: edge.kind === 'campaign' ? { quarterKey: edge.quarterKey, startsOn: edge.startsOn, endsOn: edge.endsOn } : edge.kind,",
      "  next: next.kind === 'campaign' ? { quarterKey: next.quarterKey, startsOn: next.startsOn, endsOn: next.endsOn } : next.kind,",
      "}) + '\\n');",
    ].join('\n');
    const run = (tz: string) => {
      const result = spawnSync(tsx, ['-e', script], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as {
        edge: { quarterKey: string; startsOn: string; endsOn: string };
        next: { quarterKey: string; startsOn: string; endsOn: string };
      };
    };
    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago).toEqual(utc);
    expect(utc.edge).toEqual({ quarterKey: '2026-Q4', startsOn: 'Oct 1, 2026', endsOn: 'Dec 31, 2026' });
    expect(utc.next).toEqual({ quarterKey: '2027-Q1', startsOn: 'Jan 1, 2027', endsOn: 'Mar 31, 2027' });
  });
});
