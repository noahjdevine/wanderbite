import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildCatalogConversionManifest,
  formatCatalogConversionSummary,
  parseCatalogConversionInput,
} from '../src/lib/offers/catalog-conversion';

const ROOT = path.resolve('.supply-gate');
const DEFAULT_INPUT = '.supply-gate/catalog-conversion-input.json';
const DEFAULT_OUTPUT = '.supply-gate/catalog-conversion-manifest.json';

type CliArgs = { input: string; output: string };

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

export function confinedConversionPath(candidate: string): string {
  const resolved = path.resolve(candidate);
  const relative = path.relative(ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('catalog conversion path rejected');
  }
  return resolved;
}

export function parseCatalogConversionArgs(argv: string[]): CliArgs {
  const args: CliArgs = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--input' || arg === '--output') {
      if (!next) throw new Error('catalog conversion argument needs a path');
      const key = arg === '--input' ? 'input' : 'output';
      args[key] = next;
      index += 1;
      continue;
    }
    throw new Error('catalog conversion unknown argument');
  }
  return args;
}

function readInput(inputPath: string): unknown {
  const confined = confinedConversionPath(inputPath);
  let rootReal: string;
  let inputReal: string;
  try {
    rootReal = realpathSync(ROOT);
    inputReal = realpathSync(confined);
  } catch {
    fail(`catalog conversion input not found: ${DEFAULT_INPUT}`);
  }
  const relative = path.relative(rootReal, inputReal);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('catalog conversion input path rejected');
  }
  let text: string;
  try {
    text = readFileSync(inputReal, 'utf8');
  } catch {
    fail('catalog conversion input unreadable');
  }
  if (Buffer.byteLength(text, 'utf8') > 16 * 1024 * 1024) {
    fail('catalog conversion input too large');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail('catalog conversion input rejected: invalid JSON');
  }
}

function writeManifest(outputPath: string, contents: string): void {
  const confined = confinedConversionPath(outputPath);
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(path.dirname(confined), { recursive: true });
  const rootReal = realpathSync(ROOT);
  const parentReal = realpathSync(path.dirname(confined));
  const relative = path.relative(rootReal, parentReal);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('catalog conversion output path rejected');
  }
  const temporary = `${confined}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, confined);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function runCatalogConversionCli(argv: string[]): number {
  let args: CliArgs;
  try {
    args = parseCatalogConversionArgs(argv);
    confinedConversionPath(args.input);
    confinedConversionPath(args.output);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'catalog conversion rejected'}\n`);
    return 2;
  }
  const parsed = parseCatalogConversionInput(readInput(args.input));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n`);
    return 2;
  }
  const manifest = buildCatalogConversionManifest(parsed.input);
  writeManifest(args.output, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(formatCatalogConversionSummary(manifest));
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  process.exitCode = runCatalogConversionCli(process.argv.slice(2));
}
