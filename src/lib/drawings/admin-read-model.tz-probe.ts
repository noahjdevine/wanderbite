import { Module } from 'node:module';

const runtime = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = runtime._load;
runtime._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const SEED = 'ab'.repeat(32);
const USER_DELETED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function main() {
  const { formatChicagoCalendarDate, summarizeDrawingsAdmin, OVER_ALLOWANCE_NOTE } = await import(
    './admin-read-model'
  );
  const closedOn = formatChicagoCalendarDate('2027-01-01T05:30:00.000Z');
  const view = summarizeDrawingsAdmin({
    campaign: {
      id: 'c1111111-1111-4111-8111-111111111111',
      quarterKey: '2027-Q1',
      mode: 'sample',
      status: 'closed',
      totalBudgetCents: 20_000,
      fulfillmentAllowanceCents: 2_000,
      activatedAt: '2026-12-15T18:00:00.000Z',
      closedAt: '2027-01-01T05:30:00.000Z',
      prizes: [
        {
          id: 'p1111111-1111-4111-8111-111111111111',
          label: 'Sample prize: First',
          quantity: 1,
          unitValueCents: 5_000,
          position: 0,
        },
      ],
    },
    selection: {
      id: '51111111-1111-4111-8111-111111111111',
      seed: SEED,
      eligibleEntryCount: 3,
      unfilledUnitCount: 0,
      runBy: 'clerk',
      createdAt: '2027-01-02T18:00:00.000Z',
      winners: [
        {
          id: 'w3333333-3333-4333-8333-333333333333',
          rank: 1,
          prizeId: 'p1111111-1111-4111-8111-111111111111',
          userId: USER_DELETED,
          unitIndex: 1,
        },
      ],
    },
    fulfillments: [
      {
        id: 'f1111111-1111-4111-8111-111111111111',
        winnerId: 'w3333333-3333-4333-8333-333333333333',
        prizeId: 'p1111111-1111-4111-8111-111111111111',
        status: 'fulfilled',
        actualCostCents: 2_500,
      },
    ],
    events: [
      {
        id: 'e1111111-1111-4111-8111-111111111111',
        fulfillmentId: 'f1111111-1111-4111-8111-111111111111',
        toStatus: 'fulfilled',
        createdAt: '2027-01-01T05:30:00.000Z',
      },
    ],
    profileIds: new Set(),
  });
  if (!view) throw new Error('summary failed');
  process.stdout.write(
    `${JSON.stringify({
      closedOn,
      viewClosedOn: view.closedOn,
      activatedAtSet: view.activatedAtSet,
      closedAtSet: view.closedAtSet,
      eventOn: view.events[0]?.on ?? null,
      costLabel: view.costLabel,
      note: view.note,
      expectedNote: OVER_ALLOWANCE_NOTE,
      member: view.winners[0]?.memberLabel ?? null,
      memberDeleted: view.winners[0]?.memberDeleted ?? null,
      fulfillmentStatus: view.winners[0]?.fulfillmentStatus ?? null,
      recordedCostCents: view.recordedCostCents,
      allowanceCents: view.allowanceCents,
      seedPreview: view.selection?.seedPreview ?? null,
    })}\n`,
  );
}

void main();
