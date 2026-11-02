// Disposable Docker Postgres only. No hosted URL, credentials, project link, or network.
import assert from 'node:assert/strict';
import { versionCapacityBuckets } from '../src/lib/offers/version-capacity';

type Sql = (query: string) => string;

const USER = 'e02c0000-0000-4000-8000-000000000001';
const MARKET = 'e02c0000-0000-4000-8000-000000000010';
const RESTAURANT = 'e02c0000-0000-4000-8000-000000000020';

const CASES = [
  {
    name: 'oct-20-chicago',
    version: 'e02c0000-0000-4000-8000-000000000301',
    item: 'e02c0000-0000-4000-8000-000000000201',
    cycle: 'e02c0000-0000-4000-8000-000000000101',
    cycleMonth: '2020-01-01',
    assignedAt: '2026-10-20T15:00:00.000Z',
    deadline: '2026-11-24T15:00:00.000Z',
    capacityTimezone: 'America/Chicago',
  },
  {
    name: 'nov-1-03z-chicago',
    version: 'e02c0000-0000-4000-8000-000000000302',
    item: 'e02c0000-0000-4000-8000-000000000202',
    cycle: 'e02c0000-0000-4000-8000-000000000102',
    cycleMonth: '2020-02-01',
    assignedAt: '2026-11-01T03:00:00.000Z',
    deadline: '2026-12-06T03:00:00.000Z',
    capacityTimezone: 'America/Chicago',
  },
  {
    name: 'just-after-chicago-november',
    version: 'e02c0000-0000-4000-8000-000000000303',
    item: 'e02c0000-0000-4000-8000-000000000203',
    cycle: 'e02c0000-0000-4000-8000-000000000103',
    cycleMonth: '2020-03-01',
    assignedAt: '2026-10-20T15:00:00.000Z',
    deadline: '2026-11-01T05:00:00.001Z',
    capacityTimezone: 'America/Chicago',
  },
  {
    name: 'same-instant-utc',
    version: 'e02c0000-0000-4000-8000-000000000304',
    item: 'e02c0000-0000-4000-8000-000000000204',
    cycle: 'e02c0000-0000-4000-8000-000000000104',
    cycleMonth: '2020-04-01',
    assignedAt: '2026-11-01T03:00:00.000Z',
    deadline: '2026-12-06T03:00:00.000Z',
    capacityTimezone: 'UTC',
  },
] as const;

function quoteIdent(value: string): string {
  if (!/^[A-Za-z0-9_+/-]+$/.test(value)) throw new Error(`unsafe token ${value}`);
  return `'${value}'`;
}

function quoteInstant(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`unsafe instant ${value}`);
  }
  return `'${value}'::timestamptz`;
}

export function runE02VersionCapacityDbTest(args: { sql: Sql }): void {
  const checks = CASES.map((testCase) => {
    const expected = versionCapacityBuckets(
      new Date(testCase.assignedAt),
      new Date(testCase.deadline),
      testCase.capacityTimezone,
    ).join(',');
    if (!/^[0-9,-]*$/.test(expected)) throw new Error(`unsafe buckets ${expected}`);
    return `
      insert into public.offer_versions (
        id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
        capacity_timezone, capacity_window_kind, capacity_max_redemptions
      ) values (
        '${testCase.version}', '${RESTAURANT}', ${quoteIdent(testCase.capacityTimezone)},
        '2020-01-01T00:00:00Z', '2030-01-01T00:00:00Z',
        '[{"threshold_cents":4000,"discount_cents":1000}]'::jsonb,
        '[]'::jsonb,
        '{"exclude_tax":true,"exclude_tip":true,"categories":[]}'::jsonb,
        ${quoteIdent(testCase.capacityTimezone)}, 'calendar_month', 1000
      );
      insert into public.challenge_cycles (id, user_id, cycle_month, status)
      values ('${testCase.cycle}', '${USER}', '${testCase.cycleMonth}', 'active');
      insert into public.challenge_items (id, cycle_id, restaurant_id, slot_number, status)
      values ('${testCase.item}', '${testCase.cycle}', '${RESTAURANT}', 1, 'assigned');
      do $$
      declare
        got text;
      begin
        perform public.reserve_version_buckets(
          '${testCase.item}'::uuid,
          '${testCase.version}'::uuid,
          '${RESTAURANT}'::uuid,
          ${quoteInstant(testCase.assignedAt)},
          ${quoteInstant(testCase.deadline)}
        );
        select coalesce(string_agg(bucket_start::text, ',' order by bucket_start), '')
          into got
        from public.capacity_reservations
        where challenge_item_id = '${testCase.item}';
        if got is distinct from '${expected}' then
          raise exception 'FAIL ${testCase.name}: sql [%] typescript [${expected}]', got;
        end if;
      end $$;
    `;
  }).join('\n');

  const output = args.sql(`
    begin;
    do $$
    begin
      if not has_table_privilege('service_role', 'public.capacity_reservations', 'SELECT') then
        raise exception 'service_role cannot select capacity_reservations';
      end if;
    end $$;
    insert into auth.users (id) values ('${USER}');
    insert into public.user_profiles (id, subscription_status, role)
    values ('${USER}', 'active', 'subscriber');
    insert into public.markets (id, name, slug)
    values ('${MARKET}', 'E02 Capacity Mirror', 'e02-capacity-mirror');
    insert into public.restaurants (id, name, status, market_id)
    values ('${RESTAURANT}', 'E02 Capacity Mirror', 'active', '${MARKET}');
    ${checks}
    select 'version-capacity-buckets-match';
    rollback;
  `);
  assert.match(output, /version-capacity-buckets-match/);
}
