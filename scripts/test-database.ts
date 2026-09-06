// Local Docker only; no Supabase URL, credentials, .env, project link or network access.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { SCHEMA_CONTRACT } from '../src/lib/schema-contract';
import { assertDatabaseTypes, assertDisposableContainer, localDockerHost, migrationPsqlArgs, TEST_IMAGE, TEST_LABEL } from './database-contract';
import type { Column } from './database-contract';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = localDockerHost(process.env.G1_DOCKER_HOST ??
  (process.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock'));
const desktopDocker = path.join(process.env.LOCALAPPDATA ?? '', 'Programs/DockerDesktop/resources/bin/docker.exe');
const docker = process.env.G1_DOCKER_BIN ?? (process.platform === 'win32' && existsSync(desktopDocker) ? desktopDocker : 'docker');
const name = `wanderbite-g1-test-${randomUUID()}`;
let id = '';
let started = false;

function run(args: string[], input?: string) {
  const result = spawnSync(docker, ['--host', host, ...args], {
    cwd: root, input, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function sql(query: string, user = 'postgres') {
  return run(['exec', '-i', id, 'psql', '-X', '-U', user, '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-Atq'], query);
}
function migrate(query: string) {
  return run(['exec', '-i', id, 'psql', ...migrationPsqlArgs()], query);
}
function inspectOwned() {
  const inspected = JSON.parse(run(['inspect', id]))[0];
  assertDisposableContainer(inspected, id, name);
  return inspected;
}

async function main() {
  assert.equal(process.argv.length, 2, 'No target URL or other arguments accepted');
  run(['image', 'inspect', TEST_IMAGE]); // Never downloads an image implicitly.
  const password = randomUUID(); // Synthetic, confined to this disposable database.
  id = run(['create', '--pull=never', '--name', name, '--label', `${TEST_LABEL}=${name}`,
    '--rm', '--network=none', '--memory=1g', '--cpus=2',
    '--tmpfs', '/var/lib/postgresql/data:rw',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', `PGPASSWORD=${password}`, TEST_IMAGE]);
  assert.match(id, /^[0-9a-f]{64}$/);
  inspectOwned();
  run(['start', id]);
  started = true;
  process.stdout.write(`Started disposable database ${name}; no published ports or network.\n`);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = inspectOwned().State;
    assert.ok(state.Running, 'Database stopped during startup');
    // TCP inside the isolated container only: the bootstrap temporary server uses a Unix socket.
    try {
      run(['exec', id, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-Atqc', 'select 1']);
      ready = true;
      break;
    } catch { await delay(1000); }
  }
  assert.ok(ready, 'Database failed to become ready within 60 seconds');
  sql(readFileSync(path.join(root, 'supabase/tests/platform-prerequisites.sql'), 'utf8'), 'supabase_admin');
  const migrations = readdirSync(path.join(root, 'supabase/migrations')).filter(n => n.endsWith('.sql')).sort();
  assert.ok(migrations.length > 0);
  const versions = migrations.map(n => n.split('_')[0]);
  assert.equal(new Set(versions).size, versions.length, 'Duplicate migration versions');
  for (const file of migrations) {
    const migration = readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
    // Keep SQL intact: psql understands dollar-quoted functions; no regex splitting.
    migrate(migration);
    process.stdout.write(`Applied ${file}\n`);
  }
  const columns: Column[] = JSON.parse(sql(`select json_agg(c) from (
    select table_name,column_name,udt_name,is_nullable,column_default,is_identity,is_generated
    from information_schema.columns where table_schema='public'
  ) c;`));
  assertDatabaseTypes(readFileSync(path.join(root, 'src/types/database.types.ts'), 'utf8'), columns, SCHEMA_CONTRACT);
  process.stdout.write(`PASS: ${migrations.length} migrations; ${Object.keys(SCHEMA_CONTRACT).length} table Row/Insert/Update contracts.\n`);
  process.stdout.write(sql(readFileSync(path.join(root, 'supabase/tests/g1-acceptance.sql'), 'utf8')) + '\n');
  process.stdout.write(sql(readFileSync(path.join(root, 'supabase/tests/g1-rls.sql'), 'utf8')) + '\n');
  process.stdout.write(sql(readFileSync(path.join(root, 'supabase/tests/g2-rls.sql'), 'utf8')) + '\n');
  process.stdout.write(sql(readFileSync(path.join(root, 'supabase/tests/g3-rls.sql'), 'utf8')) + '\n');
  // Exercise the exact migrations on populated pre-fix shapes, then roll back.
  const slug = readFileSync(path.join(root, 'supabase/migrations/20260902225901_markets_slug_required.sql'), 'utf8');
  const icons = readFileSync(path.join(root, 'supabase/migrations/20260902225902_badge_icon_glyphs.sql'), 'utf8');
  // Never strip transaction statements: test the actual migration as shipped.
  sql(`begin;
    alter table public.markets alter column slug drop not null;
    insert into public.markets (name,slug) values ('Legacy URL', 'keep-this-url');
    ${slug}
    ${slug}
    do $$ begin
      if not exists (select 1 from public.markets where slug='keep-this-url') then
        raise exception 'Existing URL was changed'; end if;
    end $$;
    update public.badges set icon='utensils' where id='first_bite';
    update public.badges set icon='custom-icon' where id='hat_trick';
    insert into auth.users (id) values ('30000000-0000-4000-8000-000000000001');
    insert into public.user_badges (user_id,badge_id,awarded_at)
      values ('30000000-0000-4000-8000-000000000001','first_bite','2000-01-01');
    ${icons}
    ${icons}
    do $$ begin
      if (select icon from public.badges where id='first_bite') <> '🍴' or
         (select icon from public.badges where id='hat_trick') <> 'custom-icon' then
        raise exception 'Icon upgrade or custom icon preservation failed'; end if;
      if not exists (select 1 from public.user_badges
          where user_id='30000000-0000-4000-8000-000000000001'
          and badge_id='first_bite' and awarded_at='2000-01-01'::timestamptz) then
        raise exception 'Existing badge award was changed'; end if;
    end $$;
    rollback;`);
  // Nonzero is expected here; a pre-existing NULL must fail, never get a made-up URL.
  assert.throws(() => sql(`begin;
    alter table public.markets alter column slug drop not null;
    insert into public.markets (name) values ('Missing legacy URL');
    ${slug}
    rollback;`), /contains null values/, 'NULL-slug migration must fail closed');
  assert.equal(sql(`select
    (select count(*) from auth.users) + (select count(*) from public.user_profiles) +
    (select count(*) from public.user_badges) + (select count(*) from public.cron_runs) +
    (select count(*) from public.markets);`), '0', 'All test fixtures must roll back');
  process.stdout.write('PASS: upgrade/reapply safety, existing URLs/custom icons preserved, NULL preflight, fixtures rolled back.\n');
  // Reproduce a failure AFTER DDL, like a failed CLI migration-history INSERT.
  sql(`create schema g1_transaction_probe;
    create table g1_transaction_probe.history (version text primary key);
    insert into g1_transaction_probe.history values ('duplicate');
    alter table public.markets alter column slug drop not null;`);
  assert.throws(() => migrate(`${slug}
    insert into g1_transaction_probe.history values ('duplicate');`), /duplicate key/);
  assert.equal(sql(`select attnotnull from pg_attribute
    where attrelid='public.markets'::regclass and attname='slug';`), 'f',
  'Failed history write must roll back the schema change too');
  assert.equal(sql('select count(*) from g1_transaction_probe.history;'), '1');
  migrate(`${slug}\ninsert into g1_transaction_probe.history values ('success');`);
  assert.equal(sql(`select attnotnull from pg_attribute
    where attrelid='public.markets'::regclass and attname='slug';`), 't');
  assert.equal(sql("select count(*) from g1_transaction_probe.history where version='success';"), '1');
  assert.equal(sql("select current_setting('lock_timeout') = '5s' or current_setting('statement_timeout') = '30s';"), 'f',
    'SET LOCAL limits must not leak to another session');
  process.stdout.write('PASS: failed history write rolls back DDL; successful DDL/history commit together.\n');
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => {
  if (!id) return;
  try {
    inspectOwned(); // Never stop/remove an existing project container or volume.
    if (started) run(['stop', '--time', '5', id]); // --rm releases only this run's tmpfs.
    else run(['rm', id]); // Empty, never-started container created by this process only.
    process.stdout.write('Disposed of this run\'s temporary database; existing databases were untouched.\n');
  } catch {
    process.stderr.write(`Cleanup could not be verified for ${name}; inspect it before stopping it manually.\n`);
    process.exitCode = 1;
  }
});
