import { Module } from 'node:module';
import { compareCreatedAt } from './fulfillment';
import type { FulfillmentStoreClient } from './fulfillment-store';

const runtime = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = runtime._load;
runtime._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const BEFORE = '2027-01-01T05:59:59.000Z';
const AFTER = '2027-01-01T00:00:01.000-06:00';
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const PRIZE_ID = '22222222-2222-4222-8222-222222222222';

function row(id: string, createdAt: string) {
  return {
    id,
    winner_id: `33333333-3333-4333-8333-${id.padStart(12, '0')}`,
    selection_id: '44444444-4444-4444-8444-444444444444',
    campaign_id: CAMPAIGN_ID,
    prize_id: PRIZE_ID,
    status: 'pending',
    simulated: true,
    actual_cost_cents: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

async function main() {
  const { checkFulfillmentTransition, summarizeFulfillment } = await import('./fulfillment');
  const { listFulfillments } = await import('./fulfillment-store');
  const listed = await listFulfillments(CAMPAIGN_ID, {
    rpc() {
      return Promise.resolve({ data: null, error: { message: 'not used' } });
    },
    from() {
      const rows = [row('bbbbbbbbbbbb', AFTER), row('aaaaaaaaaaaa', BEFORE)];
      const ordered = {
        order() {
          return ordered;
        },
        range() {
          return Promise.resolve({ data: rows, error: null });
        },
        then(
          onFulfilled: (value: { data: typeof rows; error: null }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
        },
      };
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: null, error: null }),
                order: () => ordered,
              };
            },
          };
        },
      };
    },
  } as FulfillmentStoreClient);
  if (!listed.ok) throw new Error('list failed');
  const summary = summarizeFulfillment(
    [
      { status: 'fulfilled', prizeId: PRIZE_ID, actualCostCents: 2500 },
      { status: 'forfeited', prizeId: PRIZE_ID, actualCostCents: null },
    ],
    [{ id: PRIZE_ID, unitValueCents: 1000 }],
  );
  process.stdout.write(
    `${JSON.stringify({
      order: listed.fulfillments.map((row) => row.id),
      compare: compareCreatedAt(BEFORE, AFTER),
      transition: checkFulfillmentTransition('pending', 'fulfilled', { actualCostCents: 2500 }),
      summary,
    })}\n`,
  );
}

void main();
