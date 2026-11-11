import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const SENTINEL = 'E09B6_FULFILLMENT_DONE';
const QUARTER = '2097-Q1';
const USER_A = 'f09b6000-0000-4000-8000-000000000001';
const ENTRY_A = 'f09b6000-0000-4000-8000-000000000011';

class PsqlSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';

  constructor(docker: string, host: string, containerId: string) {
    this.child = spawn(docker, [
      '--host', host, 'exec', '-i', containerId,
      'psql', '-X', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=0', '-Atq',
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
      if (slice.includes(SENTINEL)) {
        // stdout (the sentinel) and stderr (ERROR) are separate pipes.
        // CI can deliver the sentinel first. Wait until the buffer is
        // quiet so an error written just after the sentinel is included.
        // The loser's text is a selected row, so it is on stdout.
        const marked = this.buffer.length;
        await delay(50);
        if (this.buffer.length !== marked) continue;
        return this.buffer.slice(before).replace(SENTINEL, '').trim();
      }
      await delay(25);
    }
    throw new Error(`E09-B6 psql wait timed out: ${this.buffer.slice(-800)}`);
  }

  close() {
    this.child.stdin.end();
  }
}

function payload(): string {
  return `jsonb_build_object(
    'quarter_key', '${QUARTER}',
    'mode', 'sample',
    'rules_version', 'v0',
    'total_budget_cents', 1000,
    'fulfillment_allowance_cents', 0,
    'eligible_entry_sources', jsonb_build_array('level_milestone'),
    'starts_at', make_timestamptz(2097, 1, 1, 0, 0, 0, 'America/Chicago'),
    'ends_at', make_timestamptz(2097, 4, 1, 0, 0, 0, 'America/Chicago'),
    'prizes', jsonb_build_array(jsonb_build_object(
      'label', 'Sample prize: Sticker',
      'quantity', 1,
      'unit_value_cents', 1000,
      'is_sample', true
    ))
  )`;
}

export async function runE09B6FulfillmentConcurrency(opts: {
  docker: string;
  host: string;
  containerId: string;
  sql: (query: string) => string;
}): Promise<void> {
  const { docker, host, containerId, sql } = opts;
  const setup = `
    do $body$
    declare
      campaign_id uuid;
      event_a uuid := gen_random_uuid();
      milestone_a uuid := gen_random_uuid();
      selection_id uuid;
    begin
      campaign_id := (public.save_drawing_campaign(${payload()})->>'id')::uuid;
      perform public.transition_drawing_campaign(campaign_id, 'active');
      perform public.transition_drawing_campaign(campaign_id, 'closed');
      insert into auth.users (id) values ('${USER_A}');
      insert into public.user_profiles (id, is_admin, role) values
        ('${USER_A}', false, 'subscriber');
      insert into public.progression_events (
        id, user_id, source_kind, source_id, occurred_at, xp, schedule_version
      ) values
        (event_a, '${USER_A}', 'verified_visit', gen_random_uuid(), '2026-01-01 00:00:00+00', 100, 'v1');
      insert into public.progression_milestones (
        id, user_id, schedule_version, level, milestone_key, reached_at, quarter_key, source_event_id
      ) values
        (milestone_a, '${USER_A}', 'v1', 1, 'v1:level:1', '2026-01-01 00:00:00+00', '${QUARTER}', event_a);
      insert into public.progression_drawing_entries (
        id, user_id, milestone_id, quarter_key, entry_source
      ) values
        ('${ENTRY_A}', '${USER_A}', milestone_a, '${QUARTER}', 'level_milestone');
      selection_id := (public.select_drawing_winners(campaign_id, 'session') -> 'selection' ->> 'id')::uuid;
      perform public.create_drawing_fulfillments(selection_id, 'session');
    end;
    $body$;
    select c.id::text
    from public.drawing_campaigns c
    where c.quarter_key = '${QUARTER}' and c.status = 'closed';
    select f.id::text
    from public.drawing_fulfillments f
    join public.drawing_campaigns c on c.id = f.campaign_id
    where c.quarter_key = '${QUARTER}';
  `;
  const lines = sql(setup).trim().split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const campaignId = lines[0] ?? '';
  const fulfillmentId = lines[1] ?? '';
  assert.match(campaignId, /^[0-9a-f-]{36}$/, campaignId);
  assert.match(fulfillmentId, /^[0-9a-f-]{36}$/, fulfillmentId);
  const a = new PsqlSession(docker, host, containerId);
  const b = new PsqlSession(docker, host, containerId);
  try {
    const held = await a.send(`
      begin;
      select (public.transition_drawing_fulfillment(
        '${fulfillmentId}'::uuid, 'ready', 'session-a', null, null
      ) ->> 'status');
    `);
    assert.equal(held, 'ready', held);
    // The result is a query row, not psql's stderr. A raised error and the
    // following \\echo can arrive on different pipes, and CI has returned
    // the sentinel before the error text was appended. Selecting the
    // caught message puts it on stdout.
    const pending = b.send(`
      begin;
      create temp table b6_loser (msg text) on commit drop;
      do $body$
      declare
        msg text;
      begin
        begin
          perform public.transition_drawing_fulfillment(
            '${fulfillmentId}'::uuid, 'ready', 'session-b', null, null
          );
          msg := 'ok';
        exception
          when others then
            msg := sqlstate || ' ' || sqlerrm;
        end;
        insert into b6_loser (msg) values (msg);
      end;
      $body$;
      select msg from b6_loser;
      commit;
    `, 20000);
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const blocked = sql(`
        select count(*)::text
        from pg_stat_activity
        where pid <> pg_backend_pid()
          and wait_event_type = 'Lock'
          and query ilike '%transition_drawing_fulfillment%';
      `).trim();
      if (blocked !== '0' && blocked !== '') {
        waiting = true;
        break;
      }
      await delay(50);
    }
    assert.equal(waiting, true, 'loser did not wait on the fulfillment lock');
    const committed = await a.send('commit;');
    assert.equal(committed, '', committed);
    const loser = await pending;
    assert.match(loser, /invalid_transition/, loser);
    assert.equal(
      sql(`select status from public.drawing_fulfillments where id = '${fulfillmentId}';`),
      'ready',
    );
    assert.equal(
      sql(`select count(*)::text from public.drawing_fulfillment_events where fulfillment_id = '${fulfillmentId}' and to_status = 'ready';`),
      '1',
    );
    assert.equal(
      sql(`select count(*)::text from public.drawing_selections where campaign_id = '${campaignId}';`),
      '1',
    );
    assert.equal(
      sql(`select count(*)::text from public.drawing_selection_winners where campaign_id = '${campaignId}';`),
      '1',
    );
  } finally {
    try { await a.send('rollback;'); } catch { /* session already closed or idle */ }
    try { await b.send('rollback;'); } catch { /* session already closed or idle */ }
    a.close();
    b.close();
    sql(`
      alter table public.drawing_fulfillment_events disable trigger drawing_fulfillment_events_guard;
      alter table public.drawing_fulfillments disable trigger drawing_fulfillments_guard;
      alter table public.drawing_selections disable trigger drawing_selections_guard;
      alter table public.drawing_selection_winners disable trigger drawing_selection_winners_guard;
      alter table public.drawing_campaigns disable trigger drawing_campaigns_lock;
      alter table public.drawing_campaign_prizes disable trigger drawing_campaign_prizes_lock;
      delete from public.drawing_fulfillment_events
      where fulfillment_id in (
        select id from public.drawing_fulfillments where campaign_id = '${campaignId}'
      );
      delete from public.drawing_fulfillments where campaign_id = '${campaignId}';
      delete from public.drawing_selection_winners where campaign_id = '${campaignId}';
      delete from public.drawing_selections where campaign_id = '${campaignId}';
      delete from public.drawing_campaigns where id = '${campaignId}';
      delete from public.user_profiles where id = '${USER_A}';
      delete from auth.users where id = '${USER_A}';
      alter table public.drawing_fulfillment_events enable trigger drawing_fulfillment_events_guard;
      alter table public.drawing_fulfillments enable trigger drawing_fulfillments_guard;
      alter table public.drawing_selections enable trigger drawing_selections_guard;
      alter table public.drawing_selection_winners enable trigger drawing_selection_winners_guard;
      alter table public.drawing_campaigns enable trigger drawing_campaigns_lock;
      alter table public.drawing_campaign_prizes enable trigger drawing_campaign_prizes_lock;
    `);
  }
}
