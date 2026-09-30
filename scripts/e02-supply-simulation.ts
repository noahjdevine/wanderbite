// Disposable Docker Postgres only. Rows are deleted before the harness empty-table check.
import assert from 'node:assert/strict';
import { chicagoMonthStart } from '../src/lib/cron-period';
import {
  bucketsIntersectingDeadline,
  plusAssignmentHours,
  simulatedMonthNow,
} from '../src/lib/challenges/supply-simulation-lifecycle';
import {
  CEILING_EXPANSION_CONFIG,
  COVERAGE_CONFIG,
  SUPPLY_MARKET_ID,
  SUPPLY_OTHER_MARKET_ID,
  SUPPLY_RESTAURANTS,
  TIGHT_CEILING_CONFIG,
  THIN_CATALOG_CONFIG,
  carryPressureLines,
  formatSupplySimulationReport,
  openMonthPair,
  runCarryPressure,
  runSimulatedSupplyMonths,
  seededMatchRate,
  supplyRestaurant,
  type CapacityLine,
  type SupplyRejection,
  type SupplyRestaurant,
} from '../src/lib/challenges/supply-simulation';

const COVERAGE = 'e0250000-0000-4000-8000-00000000a001';
const OTHER = 'e0250000-0000-4000-8000-00000000a002';
const THIN = 'e0250000-0000-4000-8000-00000000a003';
const TIGHT = 'e0250000-0000-4000-8000-00000000a004';
const ADMIN = 'e0250000-0000-4000-8000-00000000a00f';
const USERS = [COVERAGE, OTHER, THIN, TIGHT, ADMIN];

type Sql = (query: string) => string;

type CreditRow = {
  id: string;
  issue_period: string;
  status: string;
  challenge_item_id: string | null;
  slot: number;
  restaurant_id: string | null;
  threshold: number | null;
};

type ReservationRow = {
  restaurant_id: string;
  bucket_start: string;
  status: 'reserved' | 'released' | 'consumed';
};

function q(id: string): string {
  return `'${id}'`;
}

function inList(ids: string[]): string {
  return ids.map(q).join(', ');
}

let rowSerial = 0x300;
function rowId(): string {
  rowSerial += 1;
  return `e025${rowSerial.toString(16).padStart(4, '0')}-0000-4000-8000-0000000000a1`;
}

function iso(at: Date): string {
  return at.toISOString();
}

function reservationStatements(args: {
  itemId: string;
  restaurant: SupplyRestaurant;
  assignedAt: Date;
  deadline: Date;
  mode: 'settled' | 'reserved' | 'released';
}): string {
  const visit = chicagoMonthStart(args.assignedAt);
  return bucketsIntersectingDeadline(args.assignedAt, args.deadline)
    .map((bucket) => {
      const status =
        args.mode === 'reserved'
          ? 'reserved'
          : args.mode === 'released'
            ? 'released'
            : bucket === visit
              ? 'consumed'
              : 'released';
      return `insert into public.capacity_reservations (
        challenge_item_id, offer_version_id, restaurant_id, capacity_timezone, bucket_start, status
      ) values (
        ${q(args.itemId)}, ${q(args.restaurant.versionId)}, ${q(args.restaurant.id)},
        'America/Chicago', ${q(bucket)}, ${q(status)}
      );`;
    })
    .join('\n');
}

function spendFor(rows: CreditRow[], beforeOpen: string | null): number {
  return rows.reduce((sum, row) => {
    if (!row.challenge_item_id || row.threshold == null) return sum;
    if (beforeOpen && row.issue_period >= beforeOpen) return sum;
    return sum + row.threshold;
  }, 0);
}

function rpcCapacity(rows: ReservationRow[]): CapacityLine[] {
  const grouped = new Map<string, CapacityLine>();
  for (const row of rows) {
    const restaurant = SUPPLY_RESTAURANTS.find((candidate) => candidate.id === row.restaurant_id);
    const key = `${row.restaurant_id}|${row.bucket_start}`;
    const line = grouped.get(key) ?? {
      source: 'rpc' as const,
      restaurantId: row.restaurant_id,
      restaurantKey: restaurant?.key ?? row.restaurant_id,
      bucketStart: row.bucket_start,
      reserved: 0,
      consumed: 0,
      released: 0,
      used: 0,
      capacityMax: restaurant?.capacityMaxRedemptions ?? 0,
      utilization: 0,
    };
    if (row.status === 'reserved') line.reserved += 1;
    else if (row.status === 'consumed') line.consumed += 1;
    else line.released += 1;
    line.used = line.reserved + line.consumed;
    line.utilization = line.capacityMax === 0 ? 0 : line.used / line.capacityMax;
    grouped.set(key, line);
  }
  return [...grouped.values()];
}

function cleanup(sql: Sql): void {
  const users = inList(USERS);
  const restaurants = inList(SUPPLY_RESTAURANTS.map((row) => row.id));
  const markets = inList([SUPPLY_MARKET_ID, SUPPLY_OTHER_MARKET_ID]);
  sql(`
    delete from public.credit_rollover_exceptions where user_id in (${users});
    delete from public.credit_swap_allowances where user_id in (${users});
    delete from public.capacity_reservations where restaurant_id in (${restaurants});
    delete from public.redemptions where user_id in (${users});
    update public.challenge_items set credit_id = null
      where cycle_id in (select id from public.challenge_cycles where user_id in (${users}));
    update public.entitlement_credits
      set status = 'expired', challenge_item_id = null
      where user_id in (${users});
    delete from public.entitlement_credits where user_id in (${users});
    update public.challenge_items set swapped_from_item_id = null
      where cycle_id in (select id from public.challenge_cycles where user_id in (${users}));
    delete from public.challenge_items
      where cycle_id in (select id from public.challenge_cycles where user_id in (${users}));
    delete from public.challenge_cycles where user_id in (${users});
    update public.restaurants set current_offer_version_id = null where id in (${restaurants});
    delete from public.offer_versions where restaurant_id in (${restaurants});
    delete from public.restaurants where id in (${restaurants});
    delete from public.markets where id in (${markets});
    delete from public.user_profiles where id in (${users});
    delete from auth.users where id in (${users});
  `);
}

export async function runE02SupplySimulation(opts: { sql: Sql }): Promise<void> {
  const { sql } = opts;
  const anchorNow = new Date();
  const coverage = runSimulatedSupplyMonths({ config: COVERAGE_CONFIG, anchorNow });
  const tight = runSimulatedSupplyMonths({ config: TIGHT_CEILING_CONFIG, anchorNow });
  const thin = runSimulatedSupplyMonths({ config: THIN_CATALOG_CONFIG, anchorNow });
  const expansion = runSimulatedSupplyMonths({ config: CEILING_EXPANSION_CONFIG, anchorNow });
  const pressure = runCarryPressure(anchorNow);
  const pair = openMonthPair(coverage);
  assert.deepEqual(pair, ['S11', 'S12']);
  const left = supplyRestaurant('S11');
  const right = supplyRestaurant('S12');
  const swapTo = supplyRestaurant('swap');

  let started = false;
  let cleanupError: unknown;
  try {
    started = true;
    const periods = JSON.parse(
      sql(`select json_build_object(
        'open', public.chicago_month_start(now()),
        'p1', (public.chicago_month_start(now()) - interval '1 month')::date,
        'p2', (public.chicago_month_start(now()) - interval '2 months')::date,
        'p3', (public.chicago_month_start(now()) - interval '3 months')::date,
        'p4', (public.chicago_month_start(now()) - interval '4 months')::date,
        'p5', (public.chicago_month_start(now()) - interval '5 months')::date
      )`),
    ) as { open: string; p1: string; p2: string; p3: string; p4: string; p5: string };
    assert.equal(periods.open, chicagoMonthStart(anchorNow));
    assert.equal(coverage.months.find((month) => month.k === 5)?.chicagoMonth, periods.p5);
    assert.equal(periods.p5 < periods.p4 && periods.p1 < periods.open, true);

    const tags = (row: SupplyRestaurant) =>
      `ARRAY[${row.cuisineTags.map((tag) => `'${tag}'`).join(', ')}]::text[]`;
    const restaurantSql = SUPPLY_RESTAURANTS.map(
      (row) => `insert into public.restaurants (id, name, status, market_id, cuisine_tags, lat, lon)
        values (${q(row.id)}, 'E02S ${row.key}', 'active', ${q(row.marketId)}, ${tags(row)}, ${row.lat}, ${row.lon});`,
    ).join('\n');
    const versionValues = SUPPLY_RESTAURANTS.map(
      (row) => `(${q(row.versionId)}, ${q(row.id)}, 'America/Chicago', now() - interval '1 day', now() + interval '400 days',
        jsonb_build_array(jsonb_build_object('threshold_cents', ${row.thresholdCents}, 'discount_cents', ${row.discountCents})),
        '[]'::jsonb, '[]'::jsonb, 'America/Chicago', 'calendar_month', ${row.capacityMaxRedemptions}, ${q(ADMIN)})`,
    ).join(',\n');
    const restaurantIds = inList(SUPPLY_RESTAURANTS.map((row) => row.id));

    const spent = (
      userId: string,
      period: string,
      k: number,
      first: SupplyRestaurant,
      second: SupplyRestaurant,
      withSwap: boolean,
    ) => {
      const cycleId = rowId();
      const firstItem = rowId();
      const secondItem = rowId();
      const successor = withSwap ? rowId() : secondItem;
      const firstCredit = rowId();
      const secondCredit = rowId();
      const assignedAt = simulatedMonthNow(anchorNow, k);
      const deadline = plusAssignmentHours(assignedAt);
      const finalSecond = withSwap ? supplyRestaurant('swap') : second;
      const sourceSql = withSwap
        ? `insert into public.challenge_items (
            id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
          ) values (
            ${q(secondItem)}, ${q(cycleId)}, ${q(second.id)}, 2, 'swapped_out', ${q(second.versionId)},
            '${iso(assignedAt)}', '${iso(deadline)}'
          );
          insert into public.challenge_items (
            id, cycle_id, restaurant_id, slot_number, status, swapped_from_item_id, offer_version_id, assigned_at, redemption_deadline
          ) values (
            ${q(successor)}, ${q(cycleId)}, ${q(finalSecond.id)}, 2, 'assigned', ${q(secondItem)}, ${q(finalSecond.versionId)},
            '${iso(assignedAt)}', '${iso(deadline)}'
          );`
        : `insert into public.challenge_items (
            id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
          ) values (
            ${q(secondItem)}, ${q(cycleId)}, ${q(second.id)}, 2, 'assigned', ${q(second.versionId)},
            '${iso(assignedAt)}', '${iso(deadline)}'
          );`;
      const reservations = [
        reservationStatements({
          itemId: firstItem,
          restaurant: first,
          assignedAt,
          deadline,
          mode: 'settled',
        }),
        withSwap
          ? reservationStatements({
              itemId: secondItem,
              restaurant: second,
              assignedAt,
              deadline,
              mode: 'released',
            })
          : '',
        reservationStatements({
          itemId: successor,
          restaurant: finalSecond,
          assignedAt,
          deadline,
          mode: withSwap ? 'reserved' : 'settled',
        }),
      ].join('\n');
      const allowance = withSwap
        ? `insert into public.credit_swap_allowances (user_id, swap_month, source_item_id)
            values (${q(userId)}, ${q(period)}, ${q(secondItem)});`
        : '';
      return `
        insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
          values (${q(cycleId)}, ${q(userId)}, ${q(period)}, 'active', 0);
        insert into public.challenge_items (
          id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
        ) values (
          ${q(firstItem)}, ${q(cycleId)}, ${q(first.id)}, 1, 'assigned', ${q(first.versionId)},
          '${iso(assignedAt)}', '${iso(deadline)}'
        );
        ${sourceSql}
        insert into public.entitlement_credits (
          id, user_id, issue_period, slot_number, status, challenge_item_id, issued_at, expires_at
        ) values
          (${q(firstCredit)}, ${q(userId)}, ${q(period)}, 1, 'spent', ${q(firstItem)}, '${iso(assignedAt)}',
            ((${q(period)}::date + interval '1 month')::timestamp at time zone 'America/Chicago')),
          (${q(secondCredit)}, ${q(userId)}, ${q(period)}, 2, 'spent', ${q(successor)}, '${iso(assignedAt)}',
            ((${q(period)}::date + interval '1 month')::timestamp at time zone 'America/Chicago'));
        update public.challenge_items set credit_id = ${q(firstCredit)} where id = ${q(firstItem)};
        update public.challenge_items set credit_id = ${q(secondCredit)} where id = ${q(successor)};
        ${reservations}
        insert into public.redemptions (
          user_id, restaurant_id, challenge_item_id, token_hash, status, verified_at, created_at
        ) values
          (${q(userId)}, ${q(first.id)}, ${q(firstItem)}, ${q(`e02ss-${firstItem}`)}, 'verified', '${iso(assignedAt)}', '${iso(assignedAt)}'),
          (${q(userId)}, ${q(finalSecond.id)}, ${q(successor)}, ${q(`e02ss-${successor}`)}, 'verified', '${iso(assignedAt)}', '${iso(assignedAt)}');
        ${allowance}
      `;
    };

    const cooldown = supplyRestaurant('cooldown');
    const cooldownItem = rowId();
    const cooldownAt = simulatedMonthNow(anchorNow, 5);
    const cap = supplyRestaurant('cap');
    const capCycle = rowId();
    const capItem = rowId();
    const n1a = rowId();
    const n1b = rowId();
    const n3a = rowId();
    const n3b = rowId();

    sql(`
      insert into auth.users (id) values
        (${q(COVERAGE)}), (${q(OTHER)}), (${q(THIN)}), (${q(TIGHT)}), (${q(ADMIN)});
      insert into public.user_profiles (id, subscription_status, role, workflow_version) values
        (${q(COVERAGE)}, 'active', 'subscriber', 'credits'),
        (${q(OTHER)}, 'active', 'subscriber', 'credits'),
        (${q(THIN)}, 'active', 'subscriber', 'credits'),
        (${q(TIGHT)}, 'active', 'subscriber', 'credits'),
        (${q(ADMIN)}, 'active', 'admin', 'legacy');
      insert into public.markets (id, name, slug) values
        (${q(SUPPLY_MARKET_ID)}, 'E02 Supply', 'e02-supply-sim'),
        (${q(SUPPLY_OTHER_MARKET_ID)}, 'E02 Supply Other', 'e02-supply-other');
      ${restaurantSql}
      insert into public.offer_versions (
        id, restaurant_id, timezone, valid_from, valid_until, tiers, boosts, exclusions,
        capacity_timezone, capacity_window_kind, capacity_max_redemptions, published_by
      ) values
      ${versionValues};
      update public.restaurants r
        set current_offer_version_id = v.id
        from public.offer_versions v
        where v.restaurant_id = r.id and r.id in (${restaurantIds});
      insert into public.challenge_cycles (id, user_id, cycle_month, status, swap_count_used)
        values (${q(capCycle)}, ${q(OTHER)}, ${q(periods.open)}, 'active', 0);
      insert into public.challenge_items (
        id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at, redemption_deadline
      ) values (
        ${q(capItem)}, ${q(capCycle)}, ${q(cap.id)}, 1, 'assigned', ${q(cap.versionId)}, now(), now() + interval '840 hours'
      );
      insert into public.capacity_reservations (
        challenge_item_id, offer_version_id, restaurant_id, capacity_timezone, bucket_start, status
      ) values (
        ${q(capItem)}, ${q(cap.versionId)}, ${q(cap.id)}, 'America/Chicago', ${q(periods.open)}, 'reserved'
      );
      ${spent(COVERAGE, periods.p5, 5, supplyRestaurant('S01'), supplyRestaurant('S02'), false)}
      ${spent(COVERAGE, periods.p4, 4, supplyRestaurant('S03'), supplyRestaurant('S04'), false)}
      ${spent(COVERAGE, periods.p2, 2, supplyRestaurant('S07'), supplyRestaurant('S08'), true)}
      ${spent(TIGHT, periods.p5, 5, supplyRestaurant('S05'), supplyRestaurant('S06'), false)}
      insert into public.challenge_items (
        id, cycle_id, restaurant_id, slot_number, status, offer_version_id, assigned_at
      )
      select ${q(cooldownItem)}, id, ${q(cooldown.id)}, 1, 'swapped_out', ${q(cooldown.versionId)}, '${iso(cooldownAt)}'
      from public.challenge_cycles
      where user_id = ${q(COVERAGE)} and cycle_month = ${q(periods.p5)};
      insert into public.redemptions (
        user_id, restaurant_id, challenge_item_id, token_hash, status, verified_at, created_at
      ) values (
        ${q(COVERAGE)}, ${q(cooldown.id)}, ${q(cooldownItem)}, ${q(`e02ss-${cooldownItem}`)}, 'verified',
        '${iso(cooldownAt)}', '${iso(cooldownAt)}'
      );
      insert into public.entitlement_credits (
        id, user_id, issue_period, slot_number, status, expires_at
      ) values
        (${q(n3a)}, ${q(COVERAGE)}, ${q(periods.p3)}, 1, 'pending',
          ((${q(periods.p3)}::date + interval '2 months')::timestamp at time zone 'America/Chicago')),
        (${q(n3b)}, ${q(COVERAGE)}, ${q(periods.p3)}, 2, 'pending',
          ((${q(periods.p3)}::date + interval '2 months')::timestamp at time zone 'America/Chicago')),
        (${q(n1a)}, ${q(COVERAGE)}, ${q(periods.p1)}, 1, 'pending',
          ((${q(periods.p1)}::date + interval '1 month')::timestamp at time zone 'America/Chicago')),
        (${q(n1b)}, ${q(COVERAGE)}, ${q(periods.p1)}, 2, 'pending',
          ((${q(periods.p1)}::date + interval '1 month')::timestamp at time zone 'America/Chicago'));
    `);

    assert.equal(
      sql(`select count(*) from public.entitlement_credits ec
        join public.challenge_items ci on ci.id = ec.challenge_item_id and ci.credit_id = ec.id
        where ec.user_id = ${q(COVERAGE)}
          and ec.issue_period in (${q(periods.p5)}, ${q(periods.p4)}, ${q(periods.p2)})
          and ec.status = 'spent'`),
      '6',
    );
    assert.equal(
      sql(`select count(*) from public.challenge_cycles
        where user_id = ${q(COVERAGE)} and cycle_month = ${q(periods.p2)} and swap_count_used = 0`),
      '1',
    );

    const rollover = sql(
      `select outcome, exception_inserted from public.rollover_credits(${q(COVERAGE)}::uuid)`,
    );
    assert.equal(rollover, 'rolled|f');
    assert.equal(
      sql(`select count(*) from public.credit_rollover_exceptions
        where user_id = ${q(COVERAGE)} and reason = 'carry_cap_exceeded'`),
      '0',
    );
    assert.equal(
      sql(`select count(*) from public.entitlement_credits
        where user_id = ${q(COVERAGE)} and issue_period = ${q(periods.p3)}
          and status = 'expired' and challenge_item_id is null
          and expires_at = ((issue_period + interval '2 months')::timestamp at time zone 'America/Chicago')
          and expires_at is distinct from ((issue_period + interval '3 months')::timestamp at time zone 'America/Chicago')`),
      '2',
    );
    assert.equal(
      sql(`select count(*) from public.entitlement_credits
        where user_id = ${q(COVERAGE)} and issue_period = ${q(periods.p1)}
          and status = 'pending' and challenge_item_id is null
          and expires_at = ((issue_period + interval '2 months')::timestamp at time zone 'America/Chicago')`),
      '2',
    );

    const below = sql(
      `select outcome from public.assign_carried_credit(${q(COVERAGE)}::uuid, ${q(n1a)}::uuid, ${q(SUPPLY_MARKET_ID)}::uuid, ${q(supplyRestaurant('L1999').id)}::uuid)`,
    );
    assert.equal(below, 'below_floor');
    const full = sql(
      `select outcome from public.assign_carried_credit(${q(COVERAGE)}::uuid, ${q(n1a)}::uuid, ${q(SUPPLY_MARKET_ID)}::uuid, ${q(cap.id)}::uuid)`,
    );
    assert.equal(full, 'capacity_full');
    assert.equal(
      sql(`select status || ':' || coalesce(challenge_item_id::text, 'null')
        from public.entitlement_credits where id = ${q(n1a)}`),
      'pending:null',
    );
    const carriedA = sql(
      `select outcome from public.assign_carried_credit(${q(COVERAGE)}::uuid, ${q(n1a)}::uuid, ${q(SUPPLY_MARKET_ID)}::uuid, ${q(supplyRestaurant('C2000').id)}::uuid)`,
    );
    const carriedB = sql(
      `select outcome from public.assign_carried_credit(${q(COVERAGE)}::uuid, ${q(n1b)}::uuid, ${q(SUPPLY_MARKET_ID)}::uuid, ${q(supplyRestaurant('C2500').id)}::uuid)`,
    );
    assert.equal(carriedA, 'linked');
    assert.equal(carriedB, 'linked');
    assert.equal(
      sql(`select count(distinct ci.restaurant_id) from public.challenge_items ci
        join public.entitlement_credits ec on ec.challenge_item_id = ci.id
        where ec.id in (${q(n1a)}, ${q(n1b)}) and ec.status = 'linked'`),
      '2',
    );

    assert.equal(
      sql(`select public.issue_period_credits(${q(COVERAGE)}::uuid, ${q(periods.open)}::date)`),
      'created',
    );
    assert.equal(
      sql(`select public.issue_period_credits(${q(COVERAGE)}::uuid, ${q(periods.open)}::date)`),
      'existing',
    );
    const under = sql(
      `select outcome from public.link_pending_credits(
        ${q(COVERAGE)}::uuid, ${q(periods.open)}::date, ${q(SUPPLY_MARKET_ID)}::uuid,
        ${q(supplyRestaurant('U1').id)}::uuid, ${q(supplyRestaurant('U2').id)}::uuid)`,
    );
    assert.equal(under, 'pair_below_floor');
    assert.equal(
      sql(`select count(*) from public.entitlement_credits
        where user_id = ${q(COVERAGE)} and issue_period = ${q(periods.open)}
          and status = 'pending' and challenge_item_id is null`),
      '2',
    );
    const linked = sql(
      `select outcome from public.link_pending_credits(
        ${q(COVERAGE)}::uuid, ${q(periods.open)}::date, ${q(SUPPLY_MARKET_ID)}::uuid,
        ${q(left.id)}::uuid, ${q(right.id)}::uuid)`,
    );
    assert.equal(linked, 'linked');
    const openItems = sql(
      `select ci.restaurant_id from public.challenge_items ci
        join public.entitlement_credits ec on ec.challenge_item_id = ci.id
        where ec.user_id = ${q(COVERAGE)} and ec.issue_period = ${q(periods.open)}
        order by ec.slot_number`,
    );
    assert.equal(openItems, `${left.id}\n${right.id}`);
    const slot2 = sql(
      `select ci.id from public.challenge_items ci
        join public.entitlement_credits ec on ec.challenge_item_id = ci.id
        where ec.user_id = ${q(COVERAGE)} and ec.issue_period = ${q(periods.open)} and ec.slot_number = 2`,
    );
    const swapped = sql(
      `select outcome from public.swap_linked_credit_item(${q(COVERAGE)}::uuid, ${q(slot2)}::uuid, ${q(swapTo.id)}::uuid)`,
    );
    assert.equal(swapped, 'created');
    const carriedItem = sql(
      `select ci.id from public.challenge_items ci
        join public.entitlement_credits ec on ec.challenge_item_id = ci.id
        where ec.id = ${q(n1a)}`,
    );
    const exhausted = sql(
      `select outcome from public.swap_linked_credit_item(
        ${q(COVERAGE)}::uuid, ${q(carriedItem)}::uuid, ${q(supplyRestaurant('Far1').id)}::uuid)`,
    );
    assert.equal(exhausted, 'swap_exhausted');
    assert.equal(
      sql(`select coalesce(max(swap_count_used), 0) from public.challenge_cycles where user_id = ${q(COVERAGE)}`),
      '0',
    );

    assert.equal(
      sql(`select public.issue_period_credits(${q(THIN)}::uuid, ${q(periods.open)}::date)`),
      'created',
    );
    const thinUnder = sql(
      `select outcome from public.link_pending_credits(
        ${q(THIN)}::uuid, ${q(periods.open)}::date, ${q(SUPPLY_MARKET_ID)}::uuid,
        ${q(supplyRestaurant('U1').id)}::uuid, ${q(supplyRestaurant('U2').id)}::uuid)`,
    );
    assert.equal(thinUnder, 'pair_below_floor');
    assert.equal(
      sql(`select count(*) from public.challenge_cycles where user_id = ${q(THIN)}`),
      '0',
    );
    assert.equal(
      sql(`select count(*) from public.entitlement_credits
        where user_id = ${q(THIN)} and status = 'pending' and challenge_item_id is null`),
      '2',
    );
    assert.equal(
      sql(`select public.issue_period_credits(${q(TIGHT)}::uuid, ${q(periods.open)}::date)`),
      'created',
    );
    assert.equal(
      sql(`select count(*) from public.challenge_cycles
        where user_id = ${q(TIGHT)} and cycle_month = ${q(periods.open)}`),
      '0',
    );

    const loadCredits = (userId: string) =>
      JSON.parse(
        sql(`select coalesce(json_agg(json_build_object(
          'id', ec.id,
          'issue_period', ec.issue_period,
          'status', ec.status,
          'challenge_item_id', ec.challenge_item_id,
          'slot', ec.slot_number,
          'restaurant_id', ci.restaurant_id,
          'threshold', public.offer_lowest_tier_cents(v.tiers)
        )), '[]'::json)
        from public.entitlement_credits ec
        left join public.challenge_items ci on ci.id = ec.challenge_item_id
        left join public.offer_versions v on v.id = ci.offer_version_id
        where ec.user_id = ${q(userId)}`),
      ) as CreditRow[];
    const coverageCredits = loadCredits(COVERAGE);
    const thinCredits = loadCredits(THIN);
    const tightCredits = loadCredits(TIGHT);
    const reservations = JSON.parse(
      sql(`select coalesce(json_agg(json_build_object(
        'restaurant_id', restaurant_id,
        'bucket_start', bucket_start,
        'status', status
      )), '[]'::json)
      from public.capacity_reservations
      where restaurant_id in (${restaurantIds})`),
    ) as ReservationRow[];
    const rpcLines = rpcCapacity(reservations);
    for (const line of rpcLines) {
      assert.ok(
        line.used <= line.capacityMax,
        `used ${line.used} over cap ${line.capacityMax} for ${line.restaurantKey} ${line.bucketStart}`,
      );
      assert.equal(line.used, line.reserved + line.consumed);
    }
    for (const line of [...coverage.capacity, ...pressure.leaveLinked.capacity]) {
      assert.ok(line.used <= line.capacityMax);
      assert.equal(line.used, line.reserved + line.consumed);
    }
    const capLine = rpcLines.find(
      (line) => line.restaurantKey === 'cap' && line.bucketStart === periods.open,
    );
    assert.ok(capLine, 'cap bucket missing');
    assert.equal(capLine.used, 1);
    assert.equal(capLine.capacityMax, 1);
    assert.equal(capLine.utilization, 1);

    const modelCarryCounts = (key: string) => {
      const lines = pressure.leaveLinked.capacity.filter((line) => line.restaurantKey === key);
      return {
        reserved: lines.reduce((sum, line) => sum + line.reserved, 0),
        consumed: lines.reduce((sum, line) => sum + line.consumed, 0),
        released: lines.reduce((sum, line) => sum + line.released, 0),
      };
    };
    const rpcCarryCounts = (key: string) => {
      const lines = rpcLines.filter((line) => line.restaurantKey === key);
      return {
        reserved: lines.reduce((sum, line) => sum + line.reserved, 0),
        consumed: lines.reduce((sum, line) => sum + line.consumed, 0),
        released: lines.reduce((sum, line) => sum + line.released, 0),
      };
    };
    for (const key of ['C2000', 'C2500']) {
      assert.deepEqual(rpcCarryCounts(key), modelCarryCounts(key), key);
    }
    const modelLinked = pressure.leaveLinked.ledger.credits.filter(
      (credit) => credit.issueK === 2 && credit.status === 'linked',
    );
    assert.equal(modelLinked.length, 2);
    assert.equal(
      sql(`select count(*) from public.entitlement_credits
        where id in (${q(n1a)}, ${q(n1b)}) and status = 'linked'`),
      '2',
    );

    const coverageSeeded = seededMatchRate(coverageCredits);
    const historicalSpend = spendFor(coverageCredits, periods.open);
    const rpcRejections: SupplyRejection[] = [
      { scope: 'rpc:coverage:below_floor', subject: supplyRestaurant('L1999').id, reason: 'below_floor' },
      { scope: 'rpc:coverage:capacity_full', subject: cap.id, reason: 'capacity_full' },
      {
        scope: 'rpc:coverage:pair_floor',
        subject: [supplyRestaurant('U1').id, supplyRestaurant('U2').id].sort().join('|'),
        reason: 'pair_below_floor',
      },
    ];
    const thinRpc: SupplyRejection[] = [
      {
        scope: 'rpc:thin_catalog:pair_floor',
        subject: [supplyRestaurant('U1').id, supplyRestaurant('U2').id].sort().join('|'),
        reason: 'pair_below_floor',
      },
    ];
    const emptySeeded = {
      numerator: 0,
      denominator: 0,
      spendCents: 0,
      rejections: [] as SupplyRejection[],
      capacity: [] as CapacityLine[],
      lines: [] as string[],
    };
    const monthLines = coverage.months.map(
      (month) =>
        `month k=${month.k} month_now=${month.monthNow} chicago_month=${month.chicagoMonth} pair=${month.pairKeys?.join('+') ?? 'none'} rollover=${month.rollover?.outcome ?? 'none'} requested_miles=${month.requestedMiles} used_miles=${month.usedMiles} expanded=${month.expanded} swap=${month.swapOutcomes.join(',') || 'none'}`,
    );
    const blocks = [
      formatSupplySimulationReport({
        config: 'coverage',
        simulatedMonths: 6,
        requestedMiles: coverage.requestedMiles,
        usedMiles: coverage.usedMiles,
        expanded: coverage.expanded,
        seeded: {
          numerator: coverageSeeded.numerator,
          denominator: coverageSeeded.denominator,
          spendCents: historicalSpend,
          rejections: rpcRejections,
          capacity: rpcLines,
          lines: [
            'seeded_oldest_period=' + periods.p5,
            'rollover=rolled',
            'carry_cap_exceeded=none',
          ],
        },
        simulatedLines: [
          `simulated_match=${coverage.numerator}/${coverage.denominator}`,
          `simulated_month_required_spend_cents=${coverage.spendCents}`,
          'simulated_spend_label=simulated_month fixture_assumption',
          ...monthLines,
        ],
        simulatedRejections: coverage.rejections,
        simulatedCapacity: coverage.capacity,
        pairSavings: coverage.pairSavings,
        carryCapExceeded: coverage.carryCapExceeded,
      }),
      formatSupplySimulationReport({
        config: 'carry_pressure',
        simulatedMonths: 3,
        requestedMiles: pressure.leaveLinked.requestedMiles,
        usedMiles: pressure.leaveLinked.usedMiles,
        expanded: pressure.leaveLinked.expanded,
        seeded: {
          numerator: 2,
          denominator: 2,
          spendCents: 8000,
          rejections: [],
          capacity: rpcLines.filter((line) => line.restaurantKey === 'C2000' || line.restaurantKey === 'C2500'),
          lines: [
            'rpc_transition=n1_rollover_and_carried_assign',
            `model_rpc_C2000=${JSON.stringify(modelCarryCounts('C2000'))}`,
            `model_rpc_C2500=${JSON.stringify(modelCarryCounts('C2500'))}`,
            'credit_status=linked',
          ],
        },
        simulatedLines: carryPressureLines(pressure),
        simulatedRejections: [
          ...pressure.leaveLinked.rejections,
          ...pressure.verifyControl.rejections,
        ],
        simulatedCapacity: pressure.leaveLinked.capacity,
        pairSavings: null,
        carryCapExceeded: false,
      }),
      formatSupplySimulationReport({
        config: 'tight_ceiling',
        simulatedMonths: 1,
        requestedMiles: tight.requestedMiles,
        usedMiles: tight.usedMiles,
        expanded: tight.expanded,
        seeded: {
          ...seededMatchRate(tightCredits),
          spendCents: spendFor(tightCredits, periods.open),
          rejections: [],
          capacity: [],
          lines: ['open_month=pending'],
        },
        simulatedLines: [
          `simulated_match=${tight.numerator}/${tight.denominator}`,
          `simulated_month_required_spend_cents=${tight.spendCents}`,
          'simulated_spend_label=simulated_month fixture_assumption',
        ],
        simulatedRejections: tight.rejections,
        simulatedCapacity: tight.capacity,
        pairSavings: null,
        carryCapExceeded: false,
      }),
      formatSupplySimulationReport({
        config: 'thin_catalog',
        simulatedMonths: 6,
        requestedMiles: thin.requestedMiles,
        usedMiles: thin.usedMiles,
        expanded: thin.expanded,
        seeded: {
          ...seededMatchRate(thinCredits),
          spendCents: 0,
          rejections: thinRpc,
          capacity: [],
          lines: ['open_month_rpc_match=0/2'],
        },
        simulatedLines: [
          `simulated_match=${thin.numerator}/${thin.denominator}`,
          `simulated_month_required_spend_cents=${thin.spendCents}`,
          'simulated_spend_label=simulated_month fixture_assumption',
        ],
        simulatedRejections: thin.rejections,
        simulatedCapacity: thin.capacity,
        pairSavings: null,
        carryCapExceeded: false,
      }),
      formatSupplySimulationReport({
        config: 'ceiling_expansion',
        simulatedMonths: 1,
        requestedMiles: expansion.requestedMiles,
        usedMiles: expansion.usedMiles,
        expanded: expansion.expanded,
        seeded: emptySeeded,
        simulatedLines: [
          `simulated_match=${expansion.numerator}/${expansion.denominator}`,
          `simulated_month_required_spend_cents=${expansion.spendCents}`,
          'simulated_spend_label=simulated_month fixture_assumption',
          `pair=${expansion.months[0]?.pairKeys?.join('+') ?? 'none'}`,
        ],
        simulatedRejections: expansion.rejections,
        simulatedCapacity: expansion.capacity,
        pairSavings: null,
        carryCapExceeded: false,
      }),
    ];
    const report = blocks.join('\n');
    process.stdout.write(`${report}\n`);

    assert.equal(coverage.months.length, 6);
    assert.equal(coverage.months[0]?.rollover, null);
    for (const month of coverage.months) {
      if (month.k < 5) assert.equal(month.rollover?.outcome === 'rolled' || month.rollover?.outcome === 'unchanged', true);
      assert.equal(month.requestedMiles, 5);
      assert.equal(month.usedMiles, 5);
      assert.equal(month.expanded, false);
    }
    assert.notEqual(coverage.months.find((month) => month.k === 0)?.rollover, null);
    assert.deepEqual(coverage.months.find((month) => month.k === 0)?.swapOutcomes, ['created', 'swap_exhausted']);
    assert.equal(coverage.numerator, 12);
    assert.equal(coverage.denominator, 12);
    assert.equal(coverage.carryCapExceeded, false);
    assert.deepEqual(pressure.leaveSnapshot, {
      vLinked: 2,
      p1Extended: 0,
      p1Expired: 2,
      outcome: 'rolled',
      carryCapExceeded: false,
      p0Assigned: 2,
      numerator: 4,
      denominator: 6,
    });
    assert.deepEqual(pressure.verifySnapshot, {
      vLinked: 0,
      p1Extended: 2,
      p1Expired: 0,
      outcome: 'rolled',
      carryCapExceeded: false,
      p0Assigned: 2,
      numerator: 4,
      denominator: 6,
    });
    assert.equal(pressure.leaveSnapshot.denominator, 6);
    assert.equal(tight.requestedMiles, 5);
    assert.equal(tight.usedMiles, 5);
    assert.equal(tight.expanded, false);
    assert.ok(tight.rejections.some((row) => row.reason === 'spending_ceiling'));
    assert.equal(thin.numerator, 0);
    assert.equal(thin.denominator, 12);
    assert.equal(seededMatchRate(thinCredits).numerator, 0);
    assert.equal(seededMatchRate(thinCredits).denominator, 2);
    assert.equal(expansion.requestedMiles, 5);
    assert.equal(expansion.usedMiles, 15);
    assert.equal(expansion.expanded, true);
    assert.equal(coverageSeeded.denominator, 12);
    assert.equal(coverageSeeded.numerator, 10);
    assert.equal(historicalSpend, 32000);
    assert.ok(coverage.pairSavings);
    assert.equal(coverage.pairSavings.baseCents, 2000);
    assert.ok(report.includes('seeded_baseline'));
    assert.ok(report.includes('simulated'));
    assert.ok(report.includes('carry_pressure_leave_linked'));
    assert.ok(report.includes('carry_pressure_verify_control'));
    assert.ok(report.includes('v_linked=2'));
    assert.ok(report.includes('v_linked=0'));
    assert.ok(report.includes('p1_expired=2'));
    assert.ok(report.includes('p1_extended=2'));
    assert.ok(report.includes('rollover=rolled'));
    assert.ok(report.includes('carry_cap_exceeded=none'));
    assert.ok(report.includes('requested_miles=5'));
    assert.ok(report.includes('used_miles=15'));
    assert.ok(report.includes('used_miles=5'));
    assert.ok(report.includes('utilization=1'));
    assert.ok(report.includes('fixture_assumption'));
    assert.ok(report.includes('simulated_match=0/12'));
    assert.ok(report.includes('seeded_match=0/2'));
    assert.ok(report.includes('pair_below_floor'));
    assert.equal(report.includes('PASS: E02 supply simulation'), false);
  } finally {
    if (started) {
      try {
        cleanup(sql);
      } catch (error) {
        cleanupError = error;
      }
    }
  }
  if (cleanupError) throw cleanupError;
  process.stdout.write('PASS: E02 supply simulation\n');
}
