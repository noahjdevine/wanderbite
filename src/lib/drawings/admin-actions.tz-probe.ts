import { Module } from 'node:module';

const runtime = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = runtime._load;
runtime._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const { formatChicagoCalendarDate } = await import('./admin-read-model');
  const { checkCampaignTransition } = await import('./campaign');
  const endsAt = '2027-04-01T05:00:00.000Z';
  const state = {
    status: 'draft' as const,
    mode: 'sample' as const,
    endsAt,
    prizeCount: 1,
    totalBudgetCents: 1_000,
    committedCents: 1_000,
  };
  const atEnd = checkCampaignTransition(state, 'active', endsAt);
  const before = checkCampaignTransition(
    state,
    'active',
    new Date(Date.parse(endsAt) - 1).toISOString(),
  );
  process.stdout.write(
    `${JSON.stringify({
      closedOn: formatChicagoCalendarDate('2027-01-01T05:30:00Z'),
      atEnd: atEnd.ok ? 'ok' : atEnd.error,
      before: before.ok ? 'ok' : before.error,
    })}\n`,
  );
}

void main();
