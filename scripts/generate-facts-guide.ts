import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderRestaurantFactsGuideModule } from '../src/lib/briefings/facts-guide-module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const markdown = readFileSync(path.join(root, 'Docs/research/restaurant-facts-guide.md'), 'utf8');
const out = path.join(root, 'src/lib/briefings/restaurant-facts-guide.generated.ts');
writeFileSync(out, renderRestaurantFactsGuideModule(markdown));
process.stdout.write(`wrote ${path.relative(root, out)}\n`);
