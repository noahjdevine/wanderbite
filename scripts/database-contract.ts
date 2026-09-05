import assert from 'node:assert/strict';
import ts from 'typescript';

export const TEST_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.134';
export const TEST_LABEL = 'com.wanderbite.g1-test';

/** -1 needs -f/-c; plain stdin alone does not enable psql's transaction wrapper. */
export function migrationPsqlArgs(): string[] {
  return ['-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
    '-Atq', '--single-transaction', '--file=-'];
}

export function localDockerHost(value: string): string {
  assert.ok(value === 'unix:///var/run/docker.sock' ||
    value === 'npipe:////./pipe/dockerDesktopLinuxEngine',
  'Only the local Docker socket or Docker Desktop Linux engine is allowed');
  return value;
}

export function assertDisposableContainer(
  container: { Id: string; Name: string; Config: { Labels: Record<string, string> };
    HostConfig: { NetworkMode: string; PortBindings: Record<string, unknown> | null; AutoRemove: boolean;
      Tmpfs: Record<string, string> };
    Mounts: { Type: string; Destination: string }[] },
  id: string, name: string,
) {
  assert.equal(container.Id, id);
  assert.equal(container.Name, `/${name}`);
  assert.match(name, /^wanderbite-g1-test-[0-9a-f-]{36}$/);
  assert.equal(container.Config.Labels[TEST_LABEL], name);
  assert.equal(container.HostConfig.NetworkMode, 'none');
  assert.equal(Object.keys(container.HostConfig.PortBindings ?? {}).length, 0);
  assert.equal(container.HostConfig.AutoRemove, true);
  assert.deepEqual(Object.keys(container.HostConfig.Tmpfs), ['/var/lib/postgresql/data']);
  // Docker reports --tmpfs in HostConfig, not consistently in Mounts (especially before start).
  assert.ok(container.Mounts.every(m => m.Type === 'tmpfs'), 'No host mounts or persistent volumes allowed');
}

export interface Column {
  table_name: string;
  column_name: string;
  udt_name: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
  is_identity: 'YES' | 'NO';
  is_generated: string;
}

function typescriptType(udt: string): string {
  if (udt.startsWith('_')) return `${typescriptType(udt.slice(1))}[]`;
  if (['int2', 'int4', 'int8', 'float4', 'float8', 'numeric'].includes(udt)) return 'number';
  if (['text', 'varchar', 'uuid', 'date', 'timestamp', 'timestamptz'].includes(udt)) return 'string';
  if (udt === 'bool') return 'boolean';
  if (['json', 'jsonb'].includes(udt)) return 'Json';
  if (['geography', 'geometry'].includes(udt)) return 'unknown';
  throw new Error(`Unhandled database type ${udt}; extend the contract deliberately`);
}

/** Compare real catalog nullability/defaults/types with all checked-in write/read shapes. */
export function assertDatabaseTypes(source: string, columns: Column[], contract: Record<string, readonly string[]>) {
  const ast = ts.createSourceFile('database.types.ts', source, ts.ScriptTarget.Latest, true);
  const database = ast.statements.find((s): s is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(s) && s.name.text === 'Database');
  assert.ok(database);
  function member(node: ts.TypeNode | undefined, name: string): ts.TypeNode {
    assert.ok(node && ts.isTypeLiteralNode(node), `Missing type literal for ${name}`);
    const property = node.members.find((m): m is ts.PropertySignature =>
      ts.isPropertySignature(m) && m.name.getText(ast).replaceAll('"', '') === name);
    assert.ok(property?.type, `Missing ${name} type`);
    return property.type;
  }
  const tables = member(member(database.type, 'public'), 'Tables');
  for (const [table, names] of Object.entries(contract)) {
    const actual = columns.filter(c => c.table_name === table);
    assert.deepEqual(actual.map(c => c.column_name).sort(), [...names].sort(), `${table} columns`);
    for (const shape of ['Row', 'Insert', 'Update']) {
      const fields = member(member(tables, table), shape);
      assert.ok(ts.isTypeLiteralNode(fields));
      const expected = Object.fromEntries(actual.map(c => {
        const base = typescriptType(c.udt_name);
        return [c.column_name, {
          optional: shape === 'Update' || (shape === 'Insert' &&
            (c.is_nullable === 'YES' || c.column_default !== null || c.is_identity === 'YES' || c.is_generated !== 'NEVER')),
          type: base === 'unknown' ? base : `${base}${c.is_nullable === 'YES' ? ' | null' : ''}`,
        }];
      }));
      const checked = Object.fromEntries(fields.members.map(field => {
        assert.ok(ts.isPropertySignature(field) && field.type);
        return [field.name.getText(ast).replaceAll('"', ''), {
          optional: !!field.questionToken,
          type: field.type.getText(ast).replace(/\s+/g, ' ').trim(),
        }];
      }));
      assert.deepEqual(checked, expected, `${table}.${shape} differs from replayed database`);
    }
  }
}
