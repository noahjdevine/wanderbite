import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAMPLE_PRIZE_MARKER, type CampaignDraft } from '@/lib/drawings/campaign';
import {
  createCampaign,
  getCampaign,
  updateCampaign,
  type CampaignStoreClient,
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
  const reads: string[] = [];
  const row = options.row === undefined ? storedRow() : options.row;
  const prizes =
    options.prizes ??
    (row && Array.isArray(row.prizes) ? (row.prizes as Record<string, unknown>[]) : []);
  const store: CampaignStoreClient = {
    async rpc(_fn, args) {
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
  return { store, calls, reads };
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

  it('has no caller in the app', () => {
    const allowed = new Set([
      'src/lib/drawings/campaign-store.ts',
      'src/lib/drawings/campaign-store.test.ts',
      'src/lib/drawings/campaign-store.tz-probe.ts',
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
        if (text.includes('drawings/campaign-store') || text.includes('save_drawing_campaign')) {
          hits.push(rel);
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(hits).toEqual([]);
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
  }, 20000);
});
