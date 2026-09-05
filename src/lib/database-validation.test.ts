import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertDatabaseTypes, assertDisposableContainer, localDockerHost, migrationPsqlArgs, TEST_LABEL } from '../../scripts/database-contract';
import type { Column } from '../../scripts/database-contract';

const root = path.resolve(__dirname, '../..');
const name = 'wanderbite-g1-test-10000000-0000-4000-8000-000000000001';
function container() {
  return { Id: 'test-id', Name: `/${name}`, Config: { Labels: { [TEST_LABEL]: name } },
    HostConfig: { NetworkMode: 'none', PortBindings: {}, AutoRemove: true,
      Tmpfs: { '/var/lib/postgresql/data': 'rw' } },
    Mounts: [{ Type: 'tmpfs', Destination: '/var/lib/postgresql/data' }] };
}
const column: Column = { table_name: 'markets', column_name: 'slug', udt_name: 'text',
  is_nullable: 'NO', column_default: null, is_identity: 'NO', is_generated: 'NEVER' };
const source = `export type Database = { public: { Tables: { markets: {
  Row: { slug: string }; Insert: { slug: string }; Update: { slug?: string }
} } } }`;

describe('local database validation safeguards', () => {
  it('leaves migration transactions to the runner and wraps direct psql replay', () => {
    const migration = readFileSync(path.join(root,
      'supabase/migrations/20260902225901_markets_slug_required.sql'), 'utf8');
    const sql = migration.replace(/--[^\n]*/g, '');
    expect(sql).not.toMatch(/^\s*(begin|start\s+transaction|commit|rollback|end)\b/im);
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(sql).toContain("set local statement_timeout = '30s'");
    expect(migrationPsqlArgs()).toContain('--single-transaction');
    expect(migrationPsqlArgs()).toContain('--file=-');
    expect(migrationPsqlArgs()).toContain('ON_ERROR_STOP=1');
  });
  it('accepts only the supported local Docker sockets', () => {
    expect(localDockerHost('unix:///var/run/docker.sock')).toBe('unix:///var/run/docker.sock');
    expect(localDockerHost('npipe:////./pipe/dockerDesktopLinuxEngine')).toContain('npipe:');
    for (const host of ['tcp://prod:2376', 'ssh://remote', 'tcp://127.0.0.1:2375', '', 'unix:///tmp/remote-proxy']) {
      expect(() => localDockerHost(host)).toThrow();
    }
  });
  it('accepts only the exact owned, isolated, disposable container', () => {
    expect(() => assertDisposableContainer(container(), 'test-id', name)).not.toThrow();
    expect(() => assertDisposableContainer(container(), 'another-id', name)).toThrow();
    expect(() => assertDisposableContainer(container(), 'test-id', 'existing-database')).toThrow();
    const external = container();
    external.HostConfig.NetworkMode = 'bridge';
    expect(() => assertDisposableContainer(external, 'test-id', name)).toThrow();
    const ports = container();
    ports.HostConfig.PortBindings = { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5432' }] };
    expect(() => assertDisposableContainer(ports, 'test-id', name)).toThrow();
    const persistent = container();
    persistent.Mounts[0].Type = 'volume';
    expect(() => assertDisposableContainer(persistent, 'test-id', name)).toThrow();
    const foreign = container();
    foreign.Config.Labels[TEST_LABEL] = 'another-project';
    expect(() => assertDisposableContainer(foreign, 'test-id', name)).toThrow();
  });
  it('compares actual columns, types, nullability and write optionality', () => {
    expect(() => assertDatabaseTypes(source, [column], { markets: ['slug'] })).not.toThrow();
    expect(() => assertDatabaseTypes(source, [{ ...column, is_nullable: 'YES' }], { markets: ['slug'] })).toThrow();
    expect(() => assertDatabaseTypes(source, [{ ...column, column_default: "'x'" }], { markets: ['slug'] })).toThrow();
    expect(() => assertDatabaseTypes(source, [{ ...column, udt_name: 'int8' }], { markets: ['slug'] })).toThrow();
    expect(() => assertDatabaseTypes(source, [], { markets: ['slug'] })).toThrow();
    expect(() => assertDatabaseTypes(source, [{ ...column, table_name: 'other' }], { markets: ['slug'] })).toThrow();
  });
  it('cannot be fooled by column names appearing only in a comment', () => {
    expect(() => assertDatabaseTypes(`// markets slug\n${source.replaceAll('slug', 'wrong')}`,
      [column], { markets: ['slug'] })).toThrow();
  });
  it('keeps the existing market seed compatible without executing its external client', () => {
    const seed = readFileSync(path.join(root, 'scripts/seed.ts'), 'utf8');
    expect(seed).toContain("slug: 'mckinney-tx'");
  });
});
