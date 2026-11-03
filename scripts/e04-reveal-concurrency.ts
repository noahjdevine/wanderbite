import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const USER = 'e04c0000-0000-4000-8000-000000000001';
const MARKET = 'e04c0000-0000-4000-8000-000000000010';
const R1 = 'e04c0000-0000-4000-8000-000000000021';
const R2 = 'e04c0000-0000-4000-8000-000000000022';
const R3 = 'e04c0000-0000-4000-8000-000000000023';
const MONTH = '2026-11-01';
const SENTINEL = 'E04_REVEAL_DONE';

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

  async send(sqlText: string, timeoutMs = 12000): Promise<string> {
    const before = this.buffer.length;
    this.child.stdin.write(`${sqlText}\n\\echo ${SENTINEL}\n`);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const slice = this.buffer.slice(before);
      if (slice.includes(SENTINEL)) return slice.replace(SENTINEL, '').trim();
      await delay(25);
    }
    throw new Error(`E04 reveal psql wait timed out: ${this.buffer.slice(-800)}`);
  }

  close() {
    this.child.stdin.end();
  }
}

function revealCall(second: string): string {
  return `select selection_source || E'\\n' || item_reasons::text || E'\\n' || array_to_string(restaurant_ids, ',')
    from public.reveal_monthly_challenge(
      '${USER}'::uuid,
      '${MONTH}'::date,
      '${MARKET}'::uuid,
      array['${R1}'::uuid, '${second}'::uuid],
      '{"summary":"race","surprise_me":false}'::jsonb,
      'deterministic_fallback',
      jsonb_build_array(
        jsonb_build_object('restaurant_id', '${R1}', 'template_id', 'deterministic_pair_v1', 'text', 'one'),
        jsonb_build_object('restaurant_id', '${second}', 'template_id', 'deterministic_pair_v1', 'text', 'two')
      ),
      '{}'::jsonb,
      'e04b.deterministic.v1'
    );`;
}

export async function runE04RevealConcurrency(opts: {
  docker: string;
  host: string;
  containerId: string;
  sql: (query: string) => string;
}): Promise<void> {
  const { docker, host, containerId, sql } = opts;
  sql(`
    insert into auth.users (id) values ('${USER}');
    insert into public.user_profiles (id, subscription_status, role)
      values ('${USER}', 'active', 'subscriber');
    insert into public.markets (id, name, slug)
      values ('${MARKET}', 'E04 Race', 'e04-race');
    insert into public.restaurants (id, name, status, market_id) values
      ('${R1}', 'E04 R1', 'active', '${MARKET}'),
      ('${R2}', 'E04 R2', 'active', '${MARKET}'),
      ('${R3}', 'E04 R3', 'active', '${MARKET}');
    insert into public.restaurant_offers (restaurant_id, active, discount_amount_cents, min_spend_cents) values
      ('${R1}', true, 1500, 4000),
      ('${R2}', true, 1500, 4000),
      ('${R3}', true, 1500, 4000);
  `);

  const a = new PsqlSession(docker, host, containerId);
  const b = new PsqlSession(docker, host, containerId);
  try {
    const first = a.send(revealCall(R2));
    const second = b.send(revealCall(R3));
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left, right, `concurrent reveals diverged: ${left} vs ${right}`);
    assert.match(left, /deterministic_fallback/);
    assert.equal(sql(`select count(*) from public.challenge_cycles where user_id = '${USER}'`), '1');
    assert.equal(sql(`select count(*) from public.challenge_reveals where user_id = '${USER}'`), '1');
    assert.equal(sql(`select count(*) from public.entitlement_credits where user_id = '${USER}'`), '0');
  } finally {
    a.close();
    b.close();
  }

  sql(`
    delete from public.challenge_reveals where user_id = '${USER}';
    delete from public.challenge_items where cycle_id in (
      select id from public.challenge_cycles where user_id = '${USER}');
    delete from public.challenge_cycles where user_id = '${USER}';
    delete from public.restaurant_offers where restaurant_id in ('${R1}','${R2}','${R3}');
    delete from public.restaurants where id in ('${R1}','${R2}','${R3}');
    delete from public.markets where id = '${MARKET}';
    delete from public.user_profiles where id = '${USER}';
    delete from auth.users where id = '${USER}';
  `);
}
