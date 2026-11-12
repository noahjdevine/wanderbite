import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAMPLE_PRIZE_MARKER, type CampaignDraft } from '@/lib/drawings/campaign';
import {
  activateCampaign,
  closeCampaign,
  createCampaign,
  getCampaign,
  updateCampaign,
  type CampaignStoreClient,
  type CampaignTransitionArgs,
  type CampaignWritePayload,
  type StoredCampaign,
} from '@/lib/drawings/campaign-store';

const ROOT = path.resolve(__dirname, '../../..');
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const PRIZE_ID = '22222222-2222-4222-8222-222222222222';

function sampleDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    quarterKey: '2027-Q1',
    mode: 'sample',
    rulesVersion: 'v0',
    totalBudgetCents: 12_000,
    fulfillmentAllowanceCents: 2_000,
    prizes: [
      {
        label: `${SAMPLE_PRIZE_MARKER}: Gift card`,
        quantity: 2,
        unitValueCents: 5_000,
        isSample: true,
      },
    ],
    eligibleEntrySources: ['level_milestone'],
    ...overrides,
  };
}

function liveDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return sampleDraft({
    quarterKey: '2027-Q2',
    mode: 'live',
    rulesVersion: 'rules-2027-04',
    prizes: [
      {
        label: 'Gift card',
        quantity: 2,
        unitValueCents: 5_000,
        isSample: false,
      },
    ],
    ...overrides,
  });
}

function storedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CAMPAIGN_ID,
    quarter_key: '2027-Q1',
    mode: 'sample',
    rules_version: 'v0',
    status: 'draft',
    total_budget_cents: 12_000,
    fulfillment_allowance_cents: 2_000,
    eligible_entry_sources: ['level_milestone'],
    starts_at: '2027-01-01T06:00:00.000Z',
    ends_at: '2027-04-01T05:00:00.000Z',
    created_at: '2026-11-10T21:00:00.000Z',
    updated_at: '2026-11-10T21:00:00.000Z',
    prizes: [
      {
        id: PRIZE_ID,
        campaign_id: CAMPAIGN_ID,
        label: `${SAMPLE_PRIZE_MARKER}: Gift card`,
        quantity: 2,
        unit_value_cents: 5_000,
        is_sample: true,
        position: 0,
      },
    ],
    ...overrides,
  };
}

function client(options: {
  row?: Record<string, unknown> | null;
  prizes?: Record<string, unknown>[];
  rpcError?: { message: string; code?: string } | null;
  throwOnRpc?: boolean;
} = {}) {
  const calls: CampaignWritePayload[] = [];
  const transitions: CampaignTransitionArgs[] = [];
  const reads: string[] = [];
  const row = options.row === undefined ? storedRow() : options.row;
  const prizes =
    options.prizes ??
    (row && Array.isArray(row.prizes) ? (row.prizes as Record<string, unknown>[]) : []);
  const store: CampaignStoreClient = {
    async rpc(fn, args) {
      if (fn === 'transition_drawing_campaign') {
        if (!('p_campaign_id' in args)) return { data: null, error: { message: 'bad rpc args' } };
        transitions.push(args);
        if (options.throwOnRpc) throw new Error('down');
        if (options.rpcError) return { data: null, error: options.rpcError };
        return {
          data: storedRow({
            ...(row ?? {}),
            id: args.p_campaign_id,
            status: args.p_to_status,
          }),
          error: null,
        };
      }
      if (!('p_payload' in args)) return { data: null, error: { message: 'bad rpc args' } };
      calls.push(args.p_payload);
      if (options.throwOnRpc) throw new Error('down');
      if (options.rpcError) return { data: null, error: options.rpcError };
      return {
        data: storedRow({
          id: args.p_payload.id ?? CAMPAIGN_ID,
          quarter_key: args.p_payload.quarter_key,
          mode: args.p_payload.mode,
          rules_version: args.p_payload.rules_version,
          total_budget_cents: args.p_payload.total_budget_cents,
          fulfillment_allowance_cents: args.p_payload.fulfillment_allowance_cents,
          eligible_entry_sources: args.p_payload.eligible_entry_sources,
          starts_at: args.p_payload.starts_at,
          ends_at: args.p_payload.ends_at,
          prizes: args.p_payload.prizes.map((prize, index) => ({
            id: PRIZE_ID,
            campaign_id: args.p_payload.id ?? CAMPAIGN_ID,
            label: prize.label,
            quantity: prize.quantity,
            unit_value_cents: prize.unit_value_cents,
            is_sample: prize.is_sample,
            position: index,
          })),
        }),
        error: null,
      };
    },
    from(table) {
      return {
        select() {
          return {
            eq(column: string, value: string) {
              reads.push(`${table}.${column}=${value}`);
              return {
                async maybeSingle() {
                  if (!row || row.id !== value) return { data: null, error: null };
                  return { data: row, error: null };
                },
                async order() {
                  return { data: prizes, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return { store, calls, reads, transitions };
}

describe('createCampaign', () => {
  it('stores a 2027-Q1 sample campaign on the Chicago quarter bounds', async () => {
    const { store, calls } = client();
    const result = await createCampaign(sampleDraft(), store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      quarter_key: '2027-Q1',
      mode: 'sample',
      rules_version: 'v0',
      total_budget_cents: 12_000,
      fulfillment_allowance_cents: 2_000,
      eligible_entry_sources: ['level_milestone'],
      starts_at: '2027-01-01T06:00:00.000Z',
      ends_at: '2027-04-01T05:00:00.000Z',
      prizes: [
        {
          label: `${SAMPLE_PRIZE_MARKER}: Gift card`,
          quantity: 2,
          unit_value_cents: 5_000,
          is_sample: true,
          position: 0,
        },
      ],
    });
    expect(calls[0]?.id).toBeUndefined();
    const campaign = (result as { ok: true; campaign: StoredCampaign }).campaign;
    expect(campaign.committedCents).toBe(12_000);
    expect(campaign.startsAt).toBe('2027-01-01T06:00:00.000Z');
    expect(campaign.endsAt).toBe('2027-04-01T05:00:00.000Z');
  });

  it('stores a 2026-Q4 sample campaign across the November DST change', async () => {
    const { store, calls } = client();
    const result = await createCampaign(sampleDraft({ quarterKey: '2026-Q4' }), store);
    expect(result.ok).toBe(true);
    expect(calls[0]?.starts_at).toBe('2026-10-01T05:00:00.000Z');
    expect(calls[0]?.ends_at).toBe('2027-01-01T06:00:00.000Z');
    const start = Date.parse(calls[0]?.starts_at ?? '');
    const end = Date.parse(calls[0]?.ends_at ?? '');
    expect(end - start).toBe((92 * 24 + 1) * 60 * 60 * 1000);
  });

  it('stores a live campaign with a rules version and a non-sample prize', async () => {
    const { store, calls } = client();
    const result = await createCampaign(liveDraft(), store);
    expect(result.ok).toBe(true);
    expect(calls[0]).toMatchObject({
      quarter_key: '2027-Q2',
      mode: 'live',
      rules_version: 'rules-2027-04',
      starts_at: '2027-04-01T05:00:00.000Z',
      ends_at: '2027-07-01T05:00:00.000Z',
      prizes: [expect.objectContaining({ is_sample: false, label: 'Gift card' })],
    });
  });

  it('rejects an over-budget draft before calling the database', async () => {
    const { store, calls } = client();
    const result = await createCampaign(sampleDraft({ totalBudgetCents: 11_999 }), store);
    expect(result).toEqual({ ok: false, errors: ['over_budget'] });
    expect(calls).toEqual([]);
  });

  it('rejects sample and live prize mistakes and blocked entry sources before the database', async () => {
    const { store, calls } = client();
    const cases: [CampaignDraft, string][] = [
      [
        sampleDraft({
          prizes: [
            {
              label: `${SAMPLE_PRIZE_MARKER}: Gift card`,
              quantity: 2,
              unitValueCents: 5_000,
              isSample: false,
            },
          ],
        }),
        'sample_prize_required',
      ],
      [
        sampleDraft({
          prizes: [{ label: 'Gift card', quantity: 2, unitValueCents: 5_000, isSample: true }],
        }),
        'sample_label_required',
      ],
      [liveDraft({ rulesVersion: '   ' }), 'invalid_rules_version'],
      [
        liveDraft({
          prizes: [
            {
              label: `${SAMPLE_PRIZE_MARKER}: Gift card`,
              quantity: 2,
              unitValueCents: 5_000,
              isSample: true,
            },
          ],
        }),
        'live_sample_prize',
      ],
      [sampleDraft({ eligibleEntrySources: ['public_review'] }), 'public_review_entry'],
      [sampleDraft({ eligibleEntrySources: ['qr_issued'] }), 'unknown_entry_source'],
      [liveDraft({ eligibleEntrySources: ['recipe'] }), 'unknown_entry_source'],
    ];
    for (const [draft, code] of cases) {
      const result = await createCampaign(draft, store);
      expect(result.ok).toBe(false);
      if (result.ok || !('errors' in result)) continue;
      expect(result.errors).toContain(code);
    }
    expect(calls).toEqual([]);
  });

  it('returns the database code when a valid draft is rejected there', async () => {
    const over = client({ rpcError: { message: 'over_budget', code: 'P0001' } });
    await expect(createCampaign(sampleDraft(), over.store)).resolves.toEqual({
      ok: false,
      errors: ['over_budget'],
    });
    expect(over.calls).toHaveLength(1);

    const open = client({
      rpcError: {
        message: 'duplicate key value violates unique constraint "drawing_campaigns_one_open_quarter_idx"',
        code: '23505',
      },
    });
    await expect(createCampaign(sampleDraft(), open.store)).resolves.toEqual({
      ok: false,
      error: 'quarter_campaign_open',
    });
  });
});

describe('updateCampaign', () => {
  it('rejects a quantity increase that exceeds the stored budget and does not write', async () => {
    const { store, calls } = client();
    const next = sampleDraft({
      prizes: [
        {
          label: `${SAMPLE_PRIZE_MARKER}: Gift card`,
          quantity: 3,
          unitValueCents: 5_000,
          isSample: true,
        },
      ],
    });
    const result = await updateCampaign(CAMPAIGN_ID, next, store);
    expect(result).toEqual({ ok: false, errors: ['over_budget'] });
    expect(calls).toEqual([]);
  });

  it('rejects a lower budget that no longer covers the same prizes and does not write', async () => {
    const { store, calls } = client();
    const result = await updateCampaign(CAMPAIGN_ID, sampleDraft({ totalBudgetCents: 11_999 }), store);
    expect(result).toEqual({ ok: false, errors: ['over_budget'] });
    expect(calls).toEqual([]);
  });

  it('writes an edit that still fits and keeps the campaign id', async () => {
    const { store, calls } = client();
    const result = await updateCampaign(CAMPAIGN_ID, sampleDraft({ rulesVersion: 'v1' }), store);
    expect(result.ok).toBe(true);
    expect(calls[0]?.id).toBe(CAMPAIGN_ID);
    expect(calls[0]?.rules_version).toBe('v1');
    expect(calls[0]?.starts_at).toBe('2027-01-01T06:00:00.000Z');
  });

  it('does not write when the campaign is missing', async () => {
    const { store, calls } = client({ row: null, prizes: [] });
    const result = await updateCampaign(CAMPAIGN_ID, sampleDraft(), store);
    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(calls).toEqual([]);
  });
});

describe('getCampaign', () => {
  it('returns the stored campaign and committed cents', async () => {
    const { store, reads } = client();
    const result = await getCampaign(CAMPAIGN_ID, store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.campaign.committedCents).toBe(12_000);
    expect(result.campaign.prizes[0]?.label).toBe(`${SAMPLE_PRIZE_MARKER}: Gift card`);
    expect(reads).toEqual([
      `drawing_campaigns.id=${CAMPAIGN_ID}`,
      `drawing_campaign_prizes.campaign_id=${CAMPAIGN_ID}`,
    ]);
  });

  it('returns not_found when the row is missing', async () => {
    const { store } = client({ row: null, prizes: [] });
    await expect(getCampaign(CAMPAIGN_ID, store)).resolves.toEqual({ ok: false, error: 'not_found' });
  });
});

describe('campaign store source', () => {
  it('is server-only and uses the service-role client', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/drawings/campaign-store.ts'), 'utf8');
    expect(source.startsWith("import 'server-only';")).toBe(true);
    expect(source).toMatch(/getSupabaseAdmin/);
    expect(source).not.toMatch(/from '@\/lib\/supabase\/client'|from '@\/lib\/supabase\/server'/);
    expect(source).not.toMatch(/E09_PROGRESSION_LEDGER_ENABLED|E09_MEMBER_PROGRESSION_UI_ENABLED/);
    expect(source).not.toMatch(/verify_redemption|record_verified_visit_progress|levelFromXp/);
  });

  it('is called from the app only by the admin drawing actions', () => {
    const appCaller = 'src/app/(site)/admin/drawings/actions.ts';
    const allowed = new Set([
      'src/lib/drawings/campaign-store.ts',
      'src/lib/drawings/campaign-store.test.ts',
      'src/lib/drawings/campaign-store.tz-probe.ts',
      appCaller,
      'src/app/(site)/admin/drawings/actions.test.ts',
    ]);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name === 'node_modules' || name === '.next') continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const rel = path.relative(ROOT, full).replaceAll('\\', '/');
        if (allowed.has(rel)) continue;
        const text = readFileSync(full, 'utf8');
        if (
          text.includes('drawings/campaign-store') ||
          text.includes('save_drawing_campaign') ||
          text.includes('transition_drawing_campaign')
        ) {
          hits.push(rel);
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(hits).toEqual([]);
    const caller = readFileSync(path.join(ROOT, appCaller), 'utf8');
    expect(caller).toMatch(/activateCampaign\(/);
    expect(caller).toMatch(/closeCampaign\(/);
    expect(caller).not.toMatch(/createCampaign|updateCampaign|save_drawing_campaign/);
  });
});

const Q4_END = '2027-01-01T06:00:00.000Z';
const Q1_END = '2027-04-01T05:00:00.000Z';

describe('activateCampaign and closeCampaign', () => {
  it('activates a 2027-Q1 sample draft one millisecond before ends_at', async () => {
    const { store, transitions, calls } = client();
    const now = '2027-04-01T04:59:59.999Z';
    const result = await activateCampaign(CAMPAIGN_ID, store, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.campaign.status).toBe('active');
    expect(transitions).toEqual([{ p_campaign_id: CAMPAIGN_ID, p_to_status: 'active' }]);
    expect(calls).toEqual([]);
  });

  it('rejects the same draft at ends_at and one millisecond after, for both quarter ends', async () => {
    const cases = [
      { endsAt: Q4_END, quarterKey: '2026-Q4', at: Q4_END, after: '2027-01-01T06:00:00.001Z' },
      { endsAt: Q1_END, quarterKey: '2027-Q1', at: Q1_END, after: '2027-04-01T05:00:00.001Z' },
    ];
    for (const boundary of cases) {
      const before = new Date(Date.parse(boundary.at) - 1).toISOString();
      const open = client({
        row: storedRow({
          quarter_key: boundary.quarterKey,
          ends_at: boundary.endsAt,
        }),
      });
      const opened = await activateCampaign(CAMPAIGN_ID, open.store, before);
      expect(opened.ok).toBe(true);
      expect(open.transitions).toHaveLength(1);

      for (const now of [boundary.at, boundary.after]) {
        const closed = client({
          row: storedRow({
            quarter_key: boundary.quarterKey,
            ends_at: boundary.endsAt,
          }),
        });
        const result = await activateCampaign(CAMPAIGN_ID, closed.store, now);
        expect(result).toEqual({ ok: false, error: 'campaign_window_ended' });
        expect(closed.transitions).toEqual([]);
      }
    }
  });

  it('blocks live activation and still allows a later draft edit', async () => {
    const live = client({ row: storedRow({ mode: 'live', quarter_key: '2027-Q2' }) });
    const blocked = await activateCampaign(CAMPAIGN_ID, live.store, '2027-01-01T00:00:00.000Z');
    expect(blocked).toEqual({ ok: false, error: 'live_activation_blocked' });
    expect(live.transitions).toEqual([]);

    const { store, calls } = client({ row: storedRow({ mode: 'live', quarter_key: '2027-Q2' }) });
    const edited = await updateCampaign(
      CAMPAIGN_ID,
      {
        quarterKey: '2027-Q2',
        mode: 'live',
        rulesVersion: 'rules-2027-04',
        totalBudgetCents: 12_000,
        fulfillmentAllowanceCents: 2_000,
        prizes: [{ label: 'Gift card', quantity: 2, unitValueCents: 5_000, isSample: false }],
        eligibleEntrySources: ['level_milestone'],
      },
      store,
    );
    expect(edited.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('rejects activation with no prizes or an over-budget commitment before the database', async () => {
    const empty = client({ row: storedRow({ prizes: [] }), prizes: [] });
    await expect(activateCampaign(CAMPAIGN_ID, empty.store, '2027-01-01T00:00:00.000Z')).resolves.toEqual({
      ok: false,
      error: 'no_prizes',
    });
    expect(empty.transitions).toEqual([]);

    const over = client({
      row: storedRow({ total_budget_cents: 11_999 }),
    });
    await expect(activateCampaign(CAMPAIGN_ID, over.store, '2027-01-01T00:00:00.000Z')).resolves.toEqual({
      ok: false,
      error: 'over_budget',
    });
    expect(over.transitions).toEqual([]);
  });

  it('closes an active campaign and rejects a later activation', async () => {
    const active = client({ row: storedRow({ status: 'active' }) });
    const closed = await closeCampaign(CAMPAIGN_ID, active.store, '2027-02-01T00:00:00.000Z');
    expect(closed.ok).toBe(true);
    expect(active.transitions).toEqual([{ p_campaign_id: CAMPAIGN_ID, p_to_status: 'closed' }]);

    const done = client({ row: storedRow({ status: 'closed' }) });
    await expect(activateCampaign(CAMPAIGN_ID, done.store, '2027-02-01T00:00:00.000Z')).resolves.toEqual({
      ok: false,
      error: 'invalid_transition',
    });
    await expect(closeCampaign(CAMPAIGN_ID, done.store, '2027-02-01T00:00:00.000Z')).resolves.toEqual({
      ok: false,
      error: 'invalid_transition',
    });
    expect(done.transitions).toEqual([]);
  });

  it('closes a draft directly', async () => {
    const { store, transitions } = client();
    const result = await closeCampaign(CAMPAIGN_ID, store, '2027-02-01T00:00:00.000Z');
    expect(result.ok).toBe(true);
    expect(transitions).toEqual([{ p_campaign_id: CAMPAIGN_ID, p_to_status: 'closed' }]);
  });

  it('returns the database transition code when the row still looks activatable', async () => {
    const blocked = client({ rpcError: { message: 'live_activation_blocked', code: 'P0001' } });
    await expect(activateCampaign(CAMPAIGN_ID, blocked.store, '2027-01-01T00:00:00.000Z')).resolves.toEqual({
      ok: false,
      error: 'live_activation_blocked',
    });

    const raced = client({
      rpcError: {
        message: 'quarter_campaign_open: drawing_campaigns_one_open_quarter_idx',
        code: '23505',
      },
    });
    await expect(activateCampaign(CAMPAIGN_ID, raced.store, '2027-01-01T00:00:00.000Z')).resolves.toEqual({
      ok: false,
      error: 'quarter_campaign_open',
    });
  });
});

describe('updateCampaign lifecycle lock', () => {
  it('returns campaign_locked for an active or closed row and does not write', async () => {
    for (const status of ['active', 'closed'] as const) {
      const { store, calls, transitions } = client({ row: storedRow({ status }) });
      const result = await updateCampaign(CAMPAIGN_ID, sampleDraft({ rulesVersion: 'v1' }), store);
      expect(result).toEqual({ ok: false, error: 'campaign_locked' });
      expect(calls).toEqual([]);
      expect(transitions).toEqual([]);
    }
  });

  it('maps a database campaign_locked on a draft that was activated underneath the read', async () => {
    const { store, calls } = client({ rpcError: { message: 'campaign_locked', code: 'P0001' } });
    const result = await updateCampaign(CAMPAIGN_ID, sampleDraft({ rulesVersion: 'v1' }), store);
    expect(result).toEqual({ ok: false, error: 'campaign_locked' });
    expect(calls).toHaveLength(1);
  });
});

describe('campaign store windows under TZ=UTC and TZ=America/Chicago', () => {
  it('sends the same Chicago quarter instants in both process time zones', () => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const probe = 'src/lib/drawings/campaign-store.tz-probe.ts';
    const run = (tz: string) => {
      const result = spawnSync(tsx, [probe], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as {
        windows: Record<string, { startsAt: string; endsAt: string }>;
        overBudgetCalls: number;
        transitions: Record<string, string>;
        storeTransitions: Record<string, { error: string; rpc: boolean }>;
      };
    };
    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago).toEqual(utc);
    expect(utc.windows['2026-Q4']).toEqual({
      startsAt: '2026-10-01T05:00:00.000Z',
      endsAt: '2027-01-01T06:00:00.000Z',
    });
    expect(utc.windows['2027-Q1']).toEqual({
      startsAt: '2027-01-01T06:00:00.000Z',
      endsAt: '2027-04-01T05:00:00.000Z',
    });
    expect(utc.overBudgetCalls).toBe(0);
    expect(utc.transitions).toEqual({
      '2026-Q4:before': 'ok',
      '2026-Q4:at': 'campaign_window_ended',
      '2026-Q4:after': 'campaign_window_ended',
      '2026-Q4:live': 'live_activation_blocked',
      '2027-Q1:before': 'ok',
      '2027-Q1:at': 'campaign_window_ended',
      '2027-Q1:after': 'campaign_window_ended',
      '2027-Q1:live': 'live_activation_blocked',
    });
    expect(utc.storeTransitions['2026-Q4:before']).toEqual({ error: 'unavailable', rpc: true });
    expect(utc.storeTransitions['2026-Q4:at']).toEqual({ error: 'campaign_window_ended', rpc: false });
    expect(utc.storeTransitions['2026-Q4:after']).toEqual({ error: 'campaign_window_ended', rpc: false });
    expect(utc.storeTransitions['2027-Q1:before']).toEqual({ error: 'unavailable', rpc: true });
    expect(utc.storeTransitions['2027-Q1:at']).toEqual({ error: 'campaign_window_ended', rpc: false });
    expect(utc.storeTransitions['2027-Q1:live']).toEqual({ error: 'live_activation_blocked', rpc: false });
  }, 20000);
});
