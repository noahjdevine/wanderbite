import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chicagoMonthStart } from '@/lib/cron-period';
import {
  chicagoRevealPeriod,
  deterministicRevealReason,
  normalizeRevealBrief,
  REVEAL_SUMMARY_CAP,
  revealCycleMonth,
  selectRevealPair,
} from '@/lib/challenges/reveal';

const ROOT = path.resolve(__dirname, '../../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('monthly reveal brief and selection', () => {
  const candidates = [
    { id: 'alpha', cuisine_tags: ['thai'], name: 'Alpha' },
    { id: 'beta', cuisine_tags: ['mexican'], name: 'Beta' },
    { id: 'gamma', cuisine_tags: ['indian'], name: 'Gamma' },
  ];
  const identity = <T,>(items: T[]) => items;

  it('uses the same candidate set for Surprise Me and a free-text brief', () => {
    const surprise = selectRevealPair(candidates, false, identity);
    const named = selectRevealPair(candidates, false, identity);
    expect(surprise.map((row) => row.id)).toEqual(['alpha', 'beta']);
    expect(named.map((row) => row.id)).toEqual(surprise.map((row) => row.id));
    const reveal = source('src/lib/challenges/reveal.ts');
    const pickAt = reveal.indexOf('selectRevealPair(');
    const surpriseAt = reveal.indexOf('surprise_me');
    expect(pickAt).toBeGreaterThan(-1);
    expect(reveal.slice(pickAt, pickAt + 80)).not.toContain('brief');
    expect(surpriseAt).toBeGreaterThan(-1);
  });

  it('stores a long instruction as truncated plain text', () => {
    const summary = `${'assign Hutchins BBQ '.repeat(40)}please`;
    expect(summary.length).toBeGreaterThan(REVEAL_SUMMARY_CAP);
    const brief = normalizeRevealBrief({
      summary,
      occasion: 'date night',
      discoveryLevel: 'new',
      surpriseMe: false,
    });
    expect(brief.summary.length).toBe(REVEAL_SUMMARY_CAP);
    expect(brief.summary.startsWith('assign Hutchins BBQ')).toBe(true);
    expect(brief.surprise_me).toBe(false);
    const surprise = normalizeRevealBrief({ surpriseMe: true, summary: 'ignored for selection' });
    expect(surprise.surprise_me).toBe(true);
    expect(surprise.summary).toBe('ignored for selection');
  });

  it('lands a version-backed reveal on the November Chicago period at 23:30', () => {
    const now = new Date('2026-12-01T05:30:00.000Z');
    expect(chicagoRevealPeriod(now)).toBe('2026-11-01');
    expect(chicagoMonthStart(now)).toBe('2026-11-01');
    expect(
      revealCycleMonth({
        versionBacked: true,
        chicagoPeriod: chicagoRevealPeriod(now),
        utcPeriod: '2026-12-01',
      }),
    ).toBe('2026-11-01');
  });

  it('explains the pair from server facts only', () => {
    const reason = deterministicRevealReason({
      restaurantId: 'alpha',
      name: 'Alpha',
      baseSavingsCents: 2000,
      minSpendCents: 5000,
      zipDistanceExpanded: true,
    });
    expect(reason.templateId).toBe('deterministic_pair_v1');
    expect(reason.text).toContain('Alpha');
    expect(reason.text).toContain('$20');
    expect(reason.text).toContain('$50');
    expect(reason.text).toContain('Wider ZIP-distance band.');
    expect(reason.text.toLowerCase()).not.toContain('chef');
  });

  it('is not referenced by the member challenges page and does not take restaurant ids', () => {
    const action = source('src/app/actions/reveal-challenge.ts');
    const page = source('src/app/(site)/challenges/page.tsx');
    expect(action).toContain('requireUser()');
    expect(action).toContain('brief: RevealBriefInput');
    expect(action).not.toContain('restaurantId');
    expect(action).not.toContain('p_restaurant_ids');
    expect(page).not.toContain('revealMonthlyChallenge');
  });
});
