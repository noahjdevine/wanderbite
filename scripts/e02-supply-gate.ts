import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseSupplySnapshot, runSupplyGate, supplyGateJson } from '../src/lib/challenges/supply-gate';

const MISSING_FILE =
  'E02 supply gate: snapshot file not found (.supply-gate/hosted-catalog.json). Run scripts/sql/e02-supply-snapshot.sql in a read-only session and save the JSON cell to .supply-gate/hosted-catalog.json.';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function parseArgs(argv: string[]): {
  snapshot: string;
  seeds: number[];
  jsonPath: string | null;
} {
  let snapshot = '.supply-gate/hosted-catalog.json';
  let trials = 20;
  let seed: number | null = null;
  let jsonPath: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--snapshot') {
      if (!next) fail('E02 supply gate: --snapshot needs a path');
      snapshot = next;
      i += 1;
    } else if (arg === '--trials') {
      if (!next || !/^[1-9]\d*$/.test(next)) fail('E02 supply gate: --trials needs a positive integer');
      trials = Number(next);
      i += 1;
    } else if (arg === '--seed') {
      if (!next || !/^[1-9]\d*$/.test(next)) fail('E02 supply gate: --seed needs a positive integer');
      seed = Number(next);
      i += 1;
    } else if (arg === '--json') {
      if (!next) fail('E02 supply gate: --json needs a path');
      jsonPath = next;
      i += 1;
    } else {
      fail('E02 supply gate: unknown argument');
    }
  }
  const seeds = seed == null ? Array.from({ length: trials }, (_, index) => index + 1) : [seed];
  return { snapshot, seeds, jsonPath };
}

function readSnapshot(filePath: string): unknown {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') fail(MISSING_FILE);
    fail('snapshot rejected: unreadable file');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail('snapshot rejected: invalid JSON');
  }
}

const args = parseArgs(process.argv.slice(2));
const parsed = parseSupplySnapshot(readSnapshot(args.snapshot));
if (!parsed.ok) fail(parsed.message);

const result = runSupplyGate({ snapshot: parsed.snapshot, seeds: args.seeds });
process.stdout.write(result.text);
if (args.jsonPath) {
  const destination = path.resolve(args.jsonPath);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, supplyGateJson(result));
}
process.exit(result.result === 'PASS' ? 0 : 1);
