import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue;
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

describe('carried assignment has no caller', () => {
  it('is not called from app or lib code, and the credits surfaces stay unchanged', () => {
    for (const rel of ['src/app', 'src/lib']) {
      for (const file of walk(path.join(ROOT, rel))) {
        if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
        expect(readFileSync(file, 'utf8'), file).not.toContain('assign_carried_credit');
      }
    }

    expect(source('src/app/actions/swap-challenge.ts')).toContain("rpc('swap_linked_credit_item'");
    expect(source('src/app/actions/swap-challenge.ts')).not.toContain(
      'Swaps are not available for this account yet.',
    );
    const challenges = source('src/app/(site)/challenges/page.tsx');
    expect(challenges).toContain(".eq('issue_period', chicagoMonthStart())");
    expect(challenges).toContain(".eq('status', 'pending')");
    expect(challenges).not.toContain('assign_carried_credit');
    expect(source('vercel.json')).not.toContain('assign_carried_credit');
    expect(source('src/lib/schema-contract.ts')).not.toContain('assign_carried_credit');
  });
});
