import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const LOCK_USER = 'e09a4c00-0000-4000-8000-000000000001';
const RACE_USER = 'e09a4c00-0000-4000-8000-000000000002';
const GRILL = 'e09a4c00-0000-4000-8000-000000000011';
const LOCK_VISITS = [
  'e09a4c00-0000-4000-8000-000000000101',
  'e09a4c00-0000-4000-8000-000000000102',
  'e09a4c00-0000-4000-8000-000000000103',
];
const RACE_VISITS = [
  'e09a4c00-0000-4000-8000-000000000201',
  'e09a4c00-0000-4000-8000-000000000202',
  'e09a4c00-0000-4000-8000-000000000203',
];
const SENTINEL = 'E09A4_BACKFILL_DONE';
const EARLY = '2026-04-01 17:00:00+00';
// Both writers insert the level-1 entry only when the crossing visit is on or
// after 2027-01-01 00:00 America/Chicago. Earlier dates make the race depend
// on which writer creates the milestone.

class PsqlSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';

  constructor(docker: string, host: string, containerId: string) {
    this.child = spawn(docker, [
      '--host', host, 'exec', '-i', containerId,
      'psql', '-X', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-Atq',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => { this.buffer += chunk; });
    this.child.stderr.on('data', (chunk: string) => { this.buffer += chunk; });
  }

  async send(sqlText: string, timeoutMs = 15000): Promise<string> {
    const before = this.buffer.length;
    this.child.stdin.write(`${sqlText}\n\\echo ${SENTINEL}\n`);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const slice = this.buffer.slice(before);
      if (slice.includes(SENTINEL)) return slice.replace(SENTINEL, '').trim();
      await delay(25);
    }
    throw new Error(`E09-A4 psql wait timed out: ${this.buffer.slice(-800)}`);
  }

  close() {
    this.child.stdin.end();
  }
}

function visitRows(userId: string, ids: readonly string[], day: string): string {
  return ids.map((id, index) => {
    const at = `(('${day}'::date + ${index})::timestamp + time '18:00') at time zone 'UTC'`;
    return `('${id}', '${userId}', '${GRILL}', md5('${id}') || md5('e09a4c${id}'), 'verified', ${at}, ${at} + interval '35 days')`;
  }).join(',\n');
}

function counts(userId: string): string {
  return `select
    (select count(*) from public.progression_events where user_id = '${userId}')::text || ',' ||
    (select count(*) from public.progression_milestones where user_id = '${userId}')::text || ',' ||
    (select count(*) from public.progression_drawing_entries where user_id = '${userId}')::text || ',' ||
    (select count(*) from public.progression_events where user_id = '${userId}' and source_id in (
      select id from public.redemptions where user_id = '${userId}'
    ))::text || ',' ||
    coalesce((select reached_at from public.progression_milestones where user_id = '${userId}' and milestone_key = 'v1:level:1')::text, '')`;
}

export async function runE09A4BackfillConcurrency(opts: {
  docker: string;
  host: string;
  containerId: string;
  sql: (query: string) => string;
}): Promise<void> {
  const { docker, host, containerId, sql } = opts;
  const a = new PsqlSession(docker, host, containerId);
  const b = new PsqlSession(docker, host, containerId);
  try {
    sql(`
      insert into auth.users (id) values ('${LOCK_USER}'), ('${RACE_USER}');
      insert into public.user_profiles (id, is_admin, role) values
        ('${LOCK_USER}', false, 'subscriber'),
        ('${RACE_USER}', false, 'subscriber');
      insert into public.restaurants (id, name, status) values
        ('${GRILL}', 'E09 A4 Lock Grill', 'active');
      insert into public.redemptions (
        id, user_id, restaurant_id, token_hash, status, verified_at, expires_at
      ) values
        ${visitRows(LOCK_USER, LOCK_VISITS, '2027-01-01')},
        ${visitRows(RACE_USER, RACE_VISITS, '2027-02-01')};
    `);
    sql(`select public.record_verified_visit_progress('${RACE_VISITS[0]}');`);
    sql(`select public.record_verified_visit_progress('${RACE_VISITS[1]}');`);
    assert.equal(sql(`select count(*) from public.progression_milestones where user_id = '${RACE_USER}'`), '0');

    await a.send(`
      begin;
      select public.backfill_verified_visit_progress(
        '${EARLY}'::timestamptz,
        '${LOCK_USER}'::uuid,
        false
      );
    `);
    const blocked = await b.send(`
      begin;
      set local lock_timeout = '2s';
      do $body$
      begin
        perform public.record_verified_visit_progress('${LOCK_VISITS[2]}'::uuid);
        raise exception 'record did not wait on the backfill lock';
      exception
        when lock_not_available then
          null;
        when others then
          raise exception 'expected lock_not_available, got % %', sqlstate, sqlerrm;
      end;
      $body$;
      rollback;
    `);
    assert.equal(blocked, '', blocked);
    await a.send('commit;');
    const replay = await b.send(`select public.record_verified_visit_progress('${LOCK_VISITS[2]}'::uuid)::text;`);
    assert.match(replay, /"events": \[\]/);
    assert.match(replay, /"milestones": \[\]/);
    assert.match(replay, /"entries": \[\]/);
    const lockCounts = sql(counts(LOCK_USER));
    assert.match(lockCounts, /^3,1,1,3,/);

    const backfill = a.send(`
      select public.backfill_verified_visit_progress(
        '${EARLY}'::timestamptz,
        '${RACE_USER}'::uuid,
        false
      )::text;
    `);
    const record = b.send(`select public.record_verified_visit_progress('${RACE_VISITS[2]}'::uuid)::text;`);
    await Promise.all([backfill, record]);
    const raceCounts = sql(counts(RACE_USER));
    assert.match(raceCounts, /^3,1,1,3,/, raceCounts);
    const raceReached = sql(`
      select reached_at = (
        select verified_at from public.redemptions where id = '${RACE_VISITS[2]}'
      )
      from public.progression_milestones
      where user_id = '${RACE_USER}' and milestone_key = 'v1:level:1';
    `);
    assert.equal(raceReached, 't');
    assert.equal(sql(`
      select count(*) from (
        select source_kind, source_id
        from public.progression_events
        where user_id in ('${LOCK_USER}', '${RACE_USER}')
        group by source_kind, source_id
        having count(*) > 1
      ) d;
    `), '0');
    assert.equal(sql(`
      select count(*) from (
        select user_id, milestone_key
        from public.progression_milestones
        where user_id in ('${LOCK_USER}', '${RACE_USER}')
        group by user_id, milestone_key
        having count(*) > 1
      ) d;
    `), '0');
  } finally {
    try { await a.send('rollback;'); } catch { /* session already closed or idle */ }
    try { await b.send('rollback;'); } catch { /* session already closed or idle */ }
    a.close();
    b.close();
    sql(`
      delete from public.progression_drawing_entries
        where user_id in ('${LOCK_USER}', '${RACE_USER}');
      delete from public.progression_milestones
        where user_id in ('${LOCK_USER}', '${RACE_USER}');
      delete from public.progression_events
        where user_id in ('${LOCK_USER}', '${RACE_USER}');
      delete from public.redemptions
        where user_id in ('${LOCK_USER}', '${RACE_USER}')
           or restaurant_id = '${GRILL}';
      delete from public.restaurants where id = '${GRILL}';
      delete from public.user_profiles where id in ('${LOCK_USER}', '${RACE_USER}');
      delete from auth.users where id in ('${LOCK_USER}', '${RACE_USER}');
    `);
  }
}
