import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mergeStaffBillOverride,
  proposeBillEligibleSubtotal,
  type BillProposal,
  type BillProposalInput,
} from '@/lib/boost/bill-proposal';
import {
  belowMinimumBill,
  categoryExcludedBill,
  masterPlanEightyTwo,
  uncertainOcrStub,
} from '@/lib/boost/fixtures/bill-scan';
import { applyExclusions, type BillParts } from '@/lib/offers/calculator';

const ROOT = path.resolve(__dirname, '../../..');

const QUOTE_FIELDS = [
  'tier_id',
  'boost_id',
  'base_discount_cents',
  'boost_discount_cents',
  'total_discount_cents',
  'below_minimum',
  'quote_version',
  'locked_boost_id',
];

function proposeOk(input: BillProposalInput): BillProposal {
  const result = proposeBillEligibleSubtotal(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result;
}

function assertNoQuoteFields(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(
    new RegExp(QUOTE_FIELDS.map((field) => `"${field}"`).join('|')),
  );
}

describe('bill proposal', () => {
  it('proposes 8200 cents for the master-plan example after tax and tip', () => {
    const result = proposeOk(masterPlanEightyTwo);
    const bill: BillParts = {
      grossCents: 10000,
      taxCents: 800,
      tipCents: 1000,
      categoryCents: [],
    };
    expect(result.proposed_eligible_subtotal_cents).toBe(8200);
    expect(result.proposed_eligible_subtotal_cents).toBe(
      applyExclusions(bill, masterPlanEightyTwo.policy),
    );
    expect(result.applied_exclusions).toEqual({
      exclude_tax: true,
      exclude_tip: true,
      categories: [],
      removed_cents: 1800,
    });
    expect(result.uncertainty_flags).toEqual([]);
    expect(result.source).toBe('fixture');
    expect(result.check_identity).toBe('fixture-check-82');
    assertNoQuoteFields(result);
  });

  it('keeps the proposal when staff confirm a different integer', () => {
    const proposal = proposeOk(masterPlanEightyTwo);
    const confirmed = mergeStaffBillOverride(proposal, 8100);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error(confirmed.code);
    expect(confirmed.confirmed_eligible_subtotal_cents).toBe(8100);
    expect(confirmed.proposal).toBe(proposal);
    expect(confirmed.proposal.proposed_eligible_subtotal_cents).toBe(8200);
    assertNoQuoteFields(confirmed);
  });

  it('proposes the below-minimum fixture without naming a tier', () => {
    const result = proposeOk(belowMinimumBill);
    expect(result.proposed_eligible_subtotal_cents).toBe(3800);
    expect(result.proposed_eligible_subtotal_cents).toBeLessThan(4000);
    expect(result.uncertainty_flags).toEqual([]);
    assertNoQuoteFields(result);
  });

  it('applies a category exclusion through the calculator', () => {
    const result = proposeOk(categoryExcludedBill);
    expect(result.proposed_eligible_subtotal_cents).toBe(6000);
    expect(result.applied_exclusions.categories).toEqual(['alcohol']);
    expect(result.applied_exclusions.removed_cents).toBe(3000);
    assertNoQuoteFields(result);
  });

  it('refuses when category exclusions would go below zero', () => {
    const result = proposeBillEligibleSubtotal({
      bill: {
        grossCents: 3000,
        taxCents: 0,
        tipCents: 0,
        categoryCents: [{ name: 'alcohol', cents: 5000 }],
      },
      policy: { excludeTax: false, excludeTip: false, categories: ['alcohol'] },
      meta: { source: 'fixture', confidence: 1 },
    });
    expect(result).toEqual({ ok: false, code: 'exclusion_overflow' });
    expect(JSON.stringify(result)).not.toMatch(/-\d/);
  });

  it('returns zero when exclusions land on zero exactly', () => {
    const result = proposeOk({
      bill: {
        grossCents: 1000,
        taxCents: 0,
        tipCents: 0,
        categoryCents: [{ name: 'alcohol', cents: 1000 }],
      },
      policy: { excludeTax: false, excludeTip: false, categories: ['alcohol'] },
      meta: { source: 'manual', confidence: 1 },
    });
    expect(result.proposed_eligible_subtotal_cents).toBe(0);
    expect(result.applied_exclusions.removed_cents).toBe(1000);
  });

  it('flags an uncertain stub and does not invent cents from line items', () => {
    const result = proposeOk(uncertainOcrStub);
    expect(result.proposed_eligible_subtotal_cents).toBeNull();
    expect(result.uncertainty_flags).toEqual([
      'low_confidence',
      'missing_subtotal',
      'ambiguous_line_items',
      'possible_card_data_stripped',
    ]);
    expect(result.applied_exclusions.removed_cents).toBeNull();
    assertNoQuoteFields(result);

    const summed = proposeOk({
      bill: {
        grossCents: null,
        taxCents: 0,
        tipCents: 0,
        categoryCents: [],
      },
      policy: uncertainOcrStub.policy,
      meta: {
        source: 'ocr_stub',
        confidence: 0.2,
        lineItems: [{ label: 'Food', cents: 8200 }],
      },
    });
    expect(summed.proposed_eligible_subtotal_cents).toBeNull();
    expect(summed.uncertainty_flags).toContain('missing_subtotal');
    expect(summed.uncertainty_flags).toContain('low_confidence');
    expect(summed.line_items?.[0]?.cents).toBe(8200);
  });

  it('does not treat an excluded missing part as zero', () => {
    const missingTax = proposeOk({
      bill: {
        grossCents: 8200,
        taxCents: null,
        tipCents: 0,
        categoryCents: [],
      },
      policy: masterPlanEightyTwo.policy,
      meta: { source: 'manual', confidence: 1 },
    });
    expect(missingTax.proposed_eligible_subtotal_cents).toBeNull();
    expect(missingTax.uncertainty_flags).toEqual(['missing_subtotal']);

    const unusedTax = proposeOk({
      bill: {
        grossCents: 8200,
        taxCents: null,
        tipCents: null,
        categoryCents: [],
      },
      policy: { excludeTax: false, excludeTip: false, categories: [] },
      meta: { source: 'manual', confidence: 1 },
    });
    expect(unusedTax.proposed_eligible_subtotal_cents).toBe(8200);
    expect(unusedTax.uncertainty_flags).toEqual([]);
  });

  it('keeps calculator cents when confidence is low and the subtotal is present', () => {
    const result = proposeOk({
      ...masterPlanEightyTwo,
      meta: { source: 'ocr_stub', confidence: 0.5, checkIdentity: 'fixture-low' },
    });
    expect(result.proposed_eligible_subtotal_cents).toBe(8200);
    expect(result.uncertainty_flags).toEqual(['low_confidence']);
  });

  it('flags ambiguous lines and redacts a card-like run', () => {
    const result = proposeOk({
      bill: {
        grossCents: 10000,
        taxCents: 800,
        tipCents: 1000,
        categoryCents: [],
      },
      policy: masterPlanEightyTwo.policy,
      meta: {
        source: 'ocr_stub',
        confidence: 0.9,
        checkIdentity: '4111111111111111',
        lineItems: [{ label: 'Food', cents: 1000 }],
      },
    });
    expect(result.proposed_eligible_subtotal_cents).toBe(8200);
    expect(result.uncertainty_flags).toEqual([
      'ambiguous_line_items',
      'possible_card_data_stripped',
    ]);
    expect(result.check_identity).toBe('[redacted]');
    expect(result.check_identity).not.toContain('4111');
  });

  it('refuses negative parts and non-integers', () => {
    expect(
      proposeBillEligibleSubtotal({
        bill: {
          grossCents: 1000,
          taxCents: -1,
          tipCents: 0,
          categoryCents: [],
        },
        policy: masterPlanEightyTwo.policy,
      }),
    ).toEqual({ ok: false, code: 'negative_parts' });
    expect(
      proposeBillEligibleSubtotal({
        bill: {
          grossCents: 10.5,
          taxCents: 0,
          tipCents: 0,
          categoryCents: [],
        },
        policy: masterPlanEightyTwo.policy,
      }),
    ).toEqual({ ok: false, code: 'invalid_bill' });
    const proposal = proposeOk(masterPlanEightyTwo);
    expect(mergeStaffBillOverride(proposal, -5)).toEqual({ ok: false, code: 'negative_parts' });
    expect(mergeStaffBillOverride(proposal, 10.5)).toEqual({ ok: false, code: 'invalid_bill' });
    expect(proposal.proposed_eligible_subtotal_cents).toBe(8200);
  });

  it('lets staff confirm cents when the proposal had no subtotal', () => {
    const proposal = proposeOk(uncertainOcrStub);
    const confirmed = mergeStaffBillOverride(proposal, 8100);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error(confirmed.code);
    expect(confirmed.confirmed_eligible_subtotal_cents).toBe(8100);
    expect(confirmed.proposal.proposed_eligible_subtotal_cents).toBeNull();
    expect(confirmed.proposal.uncertainty_flags.length).toBeGreaterThan(0);
  });

  it('stays a pure module with no quote, app, database, or provider call', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/boost/bill-proposal.ts'), 'utf8');
    expect(source).toContain('applyExclusions');
    expect(source).not.toMatch(/\bquoteBoost\s*\(|\bquoteOffer\s*\(|\bselectBoost\s*\(|\bselectQualifyingTier\s*\(/);
    expect(source).not.toMatch(/from ['"]@\/lib\/boost\/quote|from ['"]@\/app|from ['"]next|supabase|use server|fetch\(/);
    const fixture = readFileSync(
      path.join(ROOT, 'src/lib/boost/fixtures/bill-scan.ts'),
      'utf8',
    );
    expect(fixture).not.toMatch(/quoteBoost|supabase|fetch\(/);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const text = readFileSync(full, 'utf8');
        if (text.includes('@/lib/boost/bill-proposal') || text.includes('lib/boost/bill-proposal')) {
          hits.push(full);
        }
      }
    };
    walk(path.join(ROOT, 'src/app'));
    expect(hits).toEqual([]);
  });
});
