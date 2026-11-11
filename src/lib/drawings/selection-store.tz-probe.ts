import { Module } from 'node:module';
import {
  DRAWING_SELECTION_ALGORITHM,
  compareRanked,
  entryRankHex,
  filterEligibleEntries,
  selectWinners,
  type EligibleEntry,
} from './selection';

const runtime = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = runtime._load;
runtime._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const SEED = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const CLOSED = '2027-03-20T18:00:00.000Z';
const Q1_START = '2027-01-01T06:00:00.000Z';

function row(id: string, reachedAt: string, quarterKey = '2027-Q1', entrySource = 'level_milestone'): EligibleEntry {
  return { id, userId: `user-${id}`, quarterKey, entrySource, reachedAt };
}

async function main() {
  const { verifySelection } = await import('./selection-store');
  const entries = [
    row('just-before', '2027-03-20T17:59:59.999Z'),
    row('at-close', CLOSED),
    row('just-after', '2027-03-20T18:00:00.001Z'),
    row('q1-start', Q1_START),
    row('q4-instant', '2027-01-01T05:30:00.000Z', '2026-Q4'),
    row('other-source', '2027-02-01T06:00:00.000Z', '2027-Q1', 'recipe'),
  ];
  const eligible = filterEligibleEntries(entries, {
    quarterKey: '2027-Q1',
    eligibleEntrySources: ['level_milestone'],
    closedAt: CLOSED,
  });
  const orderedEligible = [...eligible].sort((left, right) =>
    compareRanked(
      { rankKey: entryRankHex(SEED, left.id), id: left.id },
      { rankKey: entryRankHex(SEED, right.id), id: right.id },
    ),
  );
  const draw = selectWinners({
    seed: SEED,
    entries: eligible.map((entry) => ({ id: entry.id, userId: entry.userId })),
    prizes: [{ id: 'prize-a', position: 0, quantity: 1 }],
    algorithmVersion: DRAWING_SELECTION_ALGORITHM,
  });
  const client = {
    async rpc() {
      return { data: null, error: { message: 'not used' } };
    },
    from(table: string) {
      const rows: Record<string, unknown>[] =
        table === 'drawing_selections'
          ? [
              {
                id: 'selection-1',
                campaign_id: 'campaign-1',
                algorithm_version: DRAWING_SELECTION_ALGORITHM,
                seed: SEED,
                eligible_entry_count: orderedEligible.length,
                eligible_member_count: orderedEligible.length,
                eligible_entry_ids: orderedEligible.map((entry) => entry.id),
                eligible_user_ids: orderedEligible.map((entry) => entry.userId),
                prize_unit_count: 1,
                unfilled_unit_count: 0,
                simulated: true,
                run_by: 'ops',
                created_at: '2027-03-20T18:00:01.000Z',
              },
            ]
          : table === 'drawing_selection_winners'
            ? [
                {
                  id: 'winner-1',
                  selection_id: 'selection-1',
                  campaign_id: 'campaign-1',
                  prize_id: 'prize-a',
                  unit_index: 1,
                  entry_id: draw.ok ? draw.winners[0].entryId : 'missing',
                  user_id: draw.ok ? draw.winners[0].userId : 'missing',
                  rank: 1,
                  created_at: '2027-03-20T18:00:01.000Z',
                },
              ]
            : table === 'drawing_campaigns'
              ? [
                  {
                    id: 'campaign-1',
                    status: 'closed',
                    mode: 'sample',
                    quarter_key: '2027-Q1',
                    eligible_entry_sources: ['level_milestone'],
                    activated_at: '2027-01-02T00:00:00.000Z',
                    closed_at: CLOSED,
                  },
                ]
              : table === 'drawing_campaign_prizes'
                ? [{ id: 'prize-a', campaign_id: 'campaign-1', position: 0, quantity: 1 }]
                : table === 'progression_drawing_entries'
                  ? entries.map((entry) => ({
                      id: entry.id,
                      user_id: entry.userId,
                      quarter_key: entry.quarterKey,
                      entry_source: entry.entrySource,
                      milestone_id: `milestone-${entry.id}`,
                    }))
                  : entries.map((entry) => ({
                      id: `milestone-${entry.id}`,
                      reached_at: entry.reachedAt,
                    }));
      const pageOf = (data: typeof rows) => ({ data, error: null });
      return {
        select() {
          return {
            eq: () => ({
              maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
              order: () => ({
                then(
                  onFulfilled: (value: { data: typeof rows; error: null }) => unknown,
                  onRejected?: (reason: unknown) => unknown,
                ) {
                  return Promise.resolve(pageOf(rows)).then(onFulfilled, onRejected);
                },
                range: async (from: number, to: number) => pageOf(rows.slice(from, to + 1)),
              }),
            }),
            in: async (_column: string, values: readonly string[]) => {
              const wanted = new Set(values);
              return pageOf(
                rows.filter((row) => typeof row.id === 'string' && wanted.has(row.id)),
              );
            },
          };
        },
      };
    },
  };
  const verified = await verifySelection('campaign-1', client as never);
  process.stdout.write(
    JSON.stringify({
      eligible: eligible.map((entry) => entry.id),
      winner: draw.ok ? draw.winners[0].entryId : null,
      verified,
    }),
  );
}

void main();
