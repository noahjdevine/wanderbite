import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const SENTINEL = 'E09B4_CAMPAIGN_DONE';
const OPEN_QUARTER = '2098-Q1';
const DIRECT_QUARTER = '2097-Q1';

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
    throw new Error(`E09-B4 psql wait timed out: ${this.buffer.slice(-800)}`);
  }

  close() {
    this.child.stdin.end();
  }
}

function payload(quarter: string): string {
  const year = quarter.slice(0, 4);
  return `jsonb_build_object(
    'quarter_key', '${quarter}',
    'mode', 'sample',
    'rules_version', 'v0',
    'total_budget_cents', 1000,
    'fulfillment_allowance_cents', 0,
    'eligible_entry_sources', jsonb_build_array('level_milestone'),
    'starts_at', make_timestamptz(${year}, 1, 1, 0, 0, 0, 'America/Chicago'),
    'ends_at', make_timestamptz(${year}, 4, 1, 0, 0, 0, 'America/Chicago'),
    'prizes', jsonb_build_array(jsonb_build_object(
      'label', 'Sample prize: Sticker',
      'quantity', 1,
      'unit_value_cents', 1000,
      'is_sample', true
    ))
  )`;
}

export async function runE09B4CampaignConcurrency(opts: {
  docker: string;
  host: string;
  containerId: string;
  sql: (query: string) => string;
}): Promise<void> {
  const { docker, host, containerId, sql } = opts;
  const a = new PsqlSession(docker, host, containerId);
  const b = new PsqlSession(docker, host, containerId);
  try {
    const directSaved = sql(`select public.save_drawing_campaign(${payload(DIRECT_QUARTER)})->>'id';`);
    const directId = directSaved.trim();
    assert.match(directId, /^[0-9a-f-]{36}$/);
    const directCommit = await a.send(`
      begin;
      update public.drawing_campaigns set status = 'active' where id = '${directId}';
      commit;
    `);
    assert.match(directCommit, /invalid_transition/);
    assert.equal(
      sql(`select status || ',' || (activated_at is null)::text from public.drawing_campaigns where id = '${directId}';`),
      'draft,true',
    );

    const opened = await a.send(`
      begin;
      select public.save_drawing_campaign(${payload(OPEN_QUARTER)})->>'id';
    `);
    const openId = opened.trim().split('\n').pop()?.trim() ?? '';
    assert.match(openId, /^[0-9a-f-]{36}$/, opened);
    const blocked = await b.send(`
      begin;
      set local lock_timeout = '2s';
      do $body$
      begin
        perform public.save_drawing_campaign(${payload(OPEN_QUARTER)});
        raise exception 'second open did not wait';
      exception
        when lock_not_available then
          null;
        when others then
          raise exception 'expected lock_not_available, got % %', sqlstate, sqlerrm;
      end;
      $body$;
    `);
    assert.equal(blocked, '', blocked);
    const activated = await a.send(`
      select public.transition_drawing_campaign('${openId}'::uuid, 'active')->>'status';
      commit;
    `);
    assert.match(activated, /^active/);
    const loser = await b.send(`
      do $body$
      begin
        perform public.save_drawing_campaign(${payload(OPEN_QUARTER)});
        raise exception 'second open committed';
      exception
        when unique_violation then
          if position('quarter_campaign_open' in sqlerrm) = 0
             or position('drawing_campaigns_one_open_quarter_idx' in sqlerrm) = 0 then
            raise exception 'expected quarter_campaign_open, got %', sqlerrm;
          end if;
        when others then
          raise exception 'expected quarter_campaign_open, got % %', sqlstate, sqlerrm;
      end;
      $body$;
      rollback;
    `);
    assert.equal(loser, '', loser);
    assert.equal(
      sql(`select status || ',' || count(*)::text from public.drawing_campaigns where quarter_key = '${OPEN_QUARTER}' and status <> 'closed' group by status;`),
      'active,1',
    );
  } finally {
    try { await a.send('rollback;'); } catch { /* session already closed or idle */ }
    try { await b.send('rollback;'); } catch { /* session already closed or idle */ }
    a.close();
    b.close();
    sql(`
      alter table public.drawing_campaigns disable trigger drawing_campaigns_lock;
      alter table public.drawing_campaign_prizes disable trigger drawing_campaign_prizes_lock;
      delete from public.drawing_campaigns where quarter_key in ('${OPEN_QUARTER}', '${DIRECT_QUARTER}');
      alter table public.drawing_campaigns enable trigger drawing_campaigns_lock;
      alter table public.drawing_campaign_prizes enable trigger drawing_campaign_prizes_lock;
    `);
  }
}
