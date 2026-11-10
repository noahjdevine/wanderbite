import { Module } from 'node:module';
import { SAMPLE_PRIZE_MARKER } from './campaign';
import type { CampaignDraft } from './campaign';
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
  const { createCampaign } = await import('./campaign-store');
  const calls: CampaignWritePayload[] = [];
  const client: CampaignStoreClient = {
    async rpc(_fn, args) {
      calls.push(args.p_payload);
      return { data: null, error: { message: 'stop' } };
    },
    from() {
      throw new Error('get');
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
  process.stdout.write(
    JSON.stringify({
      windows,
      overBudgetCalls: calls.length,
    }),
  );
}

void main();
