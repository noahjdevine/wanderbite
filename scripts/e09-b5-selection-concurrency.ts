import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const SENTINEL = 'E09B5_SELECTION_DONE';
const QUARTER = '2096-Q1';
const USER_A = 'f09b5000-0000-4000-8000-000000000001';
const USER_B = 'f09b5000-0000-4000-8000-000000000002';
const ENTRY_A = 'f09b5000-0000-4000-8000-000000000011';
const ENTRY_B = 'f09b5000-0000-4000-8000-000000000012';

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
      if (slice.includes(SENTINEL)) return slice.replace(SENTINEL, '').trim();
      await delay(25);
    }
    throw new Error(`E09-B5 psql wait timed out: ${this.buffer.slice(-800)}`);
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
    'starts_at', make_timestamptz(2096, 1, 1, 0, 0, 0, 'America/Chicago'),
    'ends_at', make_timestamptz(2096, 4, 1, 0, 0, 0, 'America/Chicago'),
    'prizes', jsonb_build_array(jsonb_build_object(
      'label', 'Sample prize: Sticker',
      'quantity', 1,
      'unit_value_cents', 1000,
      'is_sample', true
    ))
  )`;
}

export async function runE09B5SelectionConcurrency(opts: {
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
      event_b uuid := gen_random_uuid();
      milestone_a uuid := gen_random_uuid();
      milestone_b uuid := gen_random_uuid();
    begin
      campaign_id := (public.save_drawing_campaign(${payload()})->>'id')::uuid;
      perform public.transition_drawing_campaign(campaign_id, 'active');
      perform public.transition_drawing_campaign(campaign_id, 'closed');
      insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');
      insert into public.user_profiles (id, is_admin, role) values
        ('${USER_A}', false, 'subscriber'),
        ('${USER_B}', false, 'subscriber');
      insert into public.progression_events (
        id, user_id, source_kind, source_id, occurred_at, xp, schedule_version
      ) values
        (event_a, '${USER_A}', 'verified_visit', gen_random_uuid(), '2026-01-01 00:00:00+00', 100, 'v1'),
        (event_b, '${USER_B}', 'verified_visit', gen_random_uuid(), '2026-01-02 00:00:00+00', 100, 'v1');
      insert into public.progression_milestones (
        id, user_id, schedule_version, level, milestone_key, reached_at, quarter_key, source_event_id
      ) values
        (milestone_a, '${USER_A}', 'v1', 1, 'v1:level:1', '2026-01-01 00:00:00+00', '${QUARTER}', event_a),
        (milestone_b, '${USER_B}', 'v1', 1, 'v1:level:1', '2026-01-02 00:00:00+00', '${QUARTER}', event_b);
      insert into public.progression_drawing_entries (
        id, user_id, milestone_id, quarter_key, entry_source
      ) values
        ('${ENTRY_A}', '${USER_A}', milestone_a, '${QUARTER}', 'level_milestone'),
        ('${ENTRY_B}', '${USER_B}', milestone_b, '${QUARTER}', 'level_milestone');
    end;
    $body$;
    select id::text from public.drawing_campaigns where quarter_key = '${QUARTER}' and status = 'closed';
  `;
  const campaignId = sql(setup).trim().split('\n').pop()?.trim() ?? '';
  assert.match(campaignId, /^[0-9a-f-]{36}$/, campaignId);
  const a = new PsqlSession(docker, host, containerId);
  const b = new PsqlSession(docker, host, containerId);
  try {
    const held = await a.send(`
      begin;
      select (public.select_drawing_winners('${campaignId}'::uuid, 'session-a')->'selection'->>'id');
    `);
    assert.match(held, /[0-9a-f-]{36}/, held);
    const pending = b.send(`
      begin;
      select public.select_drawing_winners('${campaignId}'::uuid, 'session-b');
    `, 20000);
    await delay(200);
    const committed = await a.send('commit;');
    assert.equal(committed, '', committed);
    const loser = await pending;
    assert.match(loser, /already_selected/, loser);
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
      alter table public.drawing_selections disable trigger drawing_selections_guard;
      alter table public.drawing_selection_winners disable trigger drawing_selection_winners_guard;
      alter table public.drawing_campaigns disable trigger drawing_campaigns_lock;
      alter table public.drawing_campaign_prizes disable trigger drawing_campaign_prizes_lock;
      delete from public.drawing_selection_winners where campaign_id = '${campaignId}';
      delete from public.drawing_selections where campaign_id = '${campaignId}';
      delete from public.drawing_campaigns where id = '${campaignId}';
      delete from public.user_profiles where id in ('${USER_A}', '${USER_B}');
      delete from auth.users where id in ('${USER_A}', '${USER_B}');
      alter table public.drawing_selections enable trigger drawing_selections_guard;
      alter table public.drawing_selection_winners enable trigger drawing_selection_winners_guard;
      alter table public.drawing_campaigns enable trigger drawing_campaigns_lock;
      alter table public.drawing_campaign_prizes enable trigger drawing_campaign_prizes_lock;
    `);
  }
}
