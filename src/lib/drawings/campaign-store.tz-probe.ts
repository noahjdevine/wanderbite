import { Module } from 'node:module';
import { SAMPLE_PRIZE_MARKER, checkCampaignTransition } from './campaign';
import type { CampaignDraft, CampaignTransitionState } from './campaign';
import type { CampaignStoreClient, CampaignWritePayload } from './campaign-store';

const runtime = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = runtime._load;
runtime._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const { activateCampaign, createCampaign } = await import('./campaign-store');
  const calls: CampaignWritePayload[] = [];
  let transitionCalls = 0;
  const stored = {
    id: '11111111-1111-4111-8111-111111111111',
    quarter_key: '2027-Q1',
    mode: 'sample' as 'sample' | 'live',
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
        id: '22222222-2222-4222-8222-222222222222',
        campaign_id: '11111111-1111-4111-8111-111111111111',
        label: `${SAMPLE_PRIZE_MARKER}: Gift card`,
        quantity: 2,
        unit_value_cents: 5_000,
        is_sample: true,
        position: 0,
      },
    ],
  };
  const client: CampaignStoreClient = {
    async rpc(fn, args) {
      if (fn === 'transition_drawing_campaign') transitionCalls += 1;
      if (fn === 'save_drawing_campaign' && 'p_payload' in args) calls.push(args.p_payload);
      return { data: null, error: { message: 'stop' } };
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: stored, error: null };
                },
                async order() {
                  return { data: stored.prizes, error: null };
                },
              };
            },
          };
        },
      };
    },
  };

  function sample(quarterKey: string): CampaignDraft {
    return {
      quarterKey,
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
    };
  }

  const windows: Record<string, { startsAt: string; endsAt: string } | undefined> = {};
  for (const quarterKey of ['2026-Q4', '2027-Q1']) {
    calls.length = 0;
    await createCampaign(sample(quarterKey), client);
    const payload = calls[0];
    windows[quarterKey] = payload
      ? { startsAt: payload.starts_at, endsAt: payload.ends_at }
      : undefined;
  }

  calls.length = 0;
  await createCampaign({ ...sample('2027-Q1'), totalBudgetCents: 11_999 }, client);

  const ends = {
    '2026-Q4': '2027-01-01T06:00:00.000Z',
    '2027-Q1': '2027-04-01T05:00:00.000Z',
  } as const;
  const transitions: Record<string, string> = {};
  for (const [quarterKey, endsAt] of Object.entries(ends)) {
    const state: CampaignTransitionState = {
      status: 'draft',
      mode: 'sample',
      endsAt,
      prizeCount: 1,
      totalBudgetCents: 12_000,
      committedCents: 12_000,
    };
    const at = Date.parse(endsAt);
    for (const [label, now] of [
      ['before', new Date(at - 1).toISOString()],
      ['at', endsAt],
      ['after', new Date(at + 1).toISOString()],
    ] as const) {
      const result = checkCampaignTransition(state, 'active', now);
      transitions[`${quarterKey}:${label}`] = result.ok ? 'ok' : result.error;
    }
    const live = checkCampaignTransition({ ...state, mode: 'live' }, 'active', new Date(at - 1).toISOString());
    transitions[`${quarterKey}:live`] = live.ok ? 'ok' : live.error;
  }

  const storeCalls = calls.length;
  const storeTransitions: Record<string, { error: string; rpc: boolean }> = {};
  for (const [quarterKey, endsAt] of Object.entries(ends)) {
    stored.quarter_key = quarterKey;
    stored.ends_at = endsAt;
    stored.mode = 'sample';
    const at = Date.parse(endsAt);
    for (const [label, now] of [
      ['before', new Date(at - 1).toISOString()],
      ['at', endsAt],
      ['after', new Date(at + 1).toISOString()],
    ] as const) {
      const beforeCalls = transitionCalls;
      const result = await activateCampaign(stored.id, client, now);
      const error = result.ok ? 'ok' : 'error' in result ? result.error : result.errors.join(',');
      storeTransitions[`${quarterKey}:${label}`] = { error, rpc: transitionCalls > beforeCalls };
    }
    stored.mode = 'live';
    const beforeLive = transitionCalls;
    const liveResult = await activateCampaign(stored.id, client, new Date(at - 1).toISOString());
    storeTransitions[`${quarterKey}:live`] = {
      error: liveResult.ok ? 'ok' : 'error' in liveResult ? liveResult.error : liveResult.errors.join(','),
      rpc: transitionCalls > beforeLive,
    };
  }
  process.stdout.write(
    JSON.stringify({
      windows,
      overBudgetCalls: storeCalls,
      transitions,
      storeTransitions,
    }),
  );
}

void main();
