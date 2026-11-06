import {
  applyExclusions,
  type BillParts,
  type ExclusionPolicy,
} from '@/lib/offers/calculator';

/**
 * Pure bill-scan proposal. Eligible cents come only from E01 `applyExclusions`.
 * This module does not call `quoteBoost`, pick a tier, pick a Boost, read a
 * database, or talk to an OCR provider. A proposal is not a discount.
 *
 * A missing subtotal stays null. Low confidence is a flag on whatever cents
 * the calculator returned. When exclusions would drive the raw subtotal below
 * zero, `applyExclusions` clamps to 0; this helper refuses `exclusion_overflow`
 * instead of proposing that 0. The check calls `applyExclusions` again with
 * gross + 1. It does not subtract tax, tip, or categories itself.
 */
export const BILL_SCAN_SOURCES = ['fixture', 'manual', 'ocr_stub'] as const;

export type BillScanSource = (typeof BILL_SCAN_SOURCES)[number];

/**
 * Confidence strictly below this is `low_confidence`. Helper default only.
 * Not a product decision.
 */
export const BILL_PROPOSAL_LOW_CONFIDENCE_BELOW = 0.8;

export const BILL_PROPOSAL_REFUSAL_CODES = [
  'invalid_bill',
  'negative_parts',
  'exclusion_overflow',
] as const;

export type BillProposalRefusalCode = (typeof BILL_PROPOSAL_REFUSAL_CODES)[number];

export const BILL_UNCERTAINTY_FLAGS = [
  'low_confidence',
  'missing_subtotal',
  'ambiguous_line_items',
  'possible_card_data_stripped',
] as const;

export type BillUncertaintyFlag = (typeof BILL_UNCERTAINTY_FLAGS)[number];

export type BillProposalLineInput = {
  label: string;
  cents: number | null;
  category?: string | null;
  confidence?: number | null;
};

export type BillProposalCategoryInput = {
  name: string;
  cents: number | null;
};

/** `BillParts` plus nulls where a reader did not supply a figure. */
export type BillProposalPartsInput = {
  grossCents: number | null;
  taxCents: number | null;
  tipCents: number | null;
  categoryCents: BillProposalCategoryInput[];
};

export type BillProposalMeta = {
  source: BillScanSource;
  checkIdentity?: string | null;
  lineItems?: BillProposalLineInput[];
  /** 0–1. Null means the reader reported an unknown score. */
  confidence?: number | null;
  ambiguousLineItems?: boolean;
  /** The caller already removed possible card data before this call. */
  cardDataStripped?: boolean;
};

export type BillProposalInput = {
  bill: BillProposalPartsInput;
  policy: ExclusionPolicy;
  meta?: BillProposalMeta;
};

export type BillProposalRefusal = {
  ok: false;
  code: BillProposalRefusalCode;
};

export type AppliedBillExclusions = {
  exclude_tax: boolean;
  exclude_tip: boolean;
  categories: string[];
  /** Gross minus `applyExclusions`. Null when the subtotal was not proposed. */
  removed_cents: number | null;
};

export type BillProposalLine = {
  label: string;
  cents: number | null;
  category?: string;
  confidence?: number | null;
};

export type BillProposal = {
  ok: true;
  proposed_eligible_subtotal_cents: number | null;
  applied_exclusions: AppliedBillExclusions;
  uncertainty_flags: BillUncertaintyFlag[];
  source: BillScanSource;
  line_items?: BillProposalLine[];
  check_identity?: string;
};

export type BillProposalResult = BillProposal | BillProposalRefusal;

export type StaffBillConfirmation = {
  ok: true;
  confirmed_eligible_subtotal_cents: number;
  proposal: BillProposal;
};

export type StaffBillConfirmationResult = StaffBillConfirmation | BillProposalRefusal;

function refuse(code: BillProposalRefusalCode): BillProposalRefusal {
  return { ok: false, code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMoney(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value));
}

function isConfidence(value: unknown): value is number | null | undefined {
  if (value === undefined || value === null) return true;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 13–19 digits, spaces or dashes allowed. Longer runs are left alone. */
function redactCardRuns(value: string): { text: string; stripped: boolean } {
  let stripped = false;
  const text = value.replace(/\d(?:[ -]?\d){12,}/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return match;
    stripped = true;
    return '[redacted]';
  });
  return { text, stripped };
}

function confidenceIsLow(
  value: number | null | undefined,
  source: BillScanSource,
): boolean {
  if (value === undefined) return source === 'ocr_stub';
  if (value === null) return true;
  return value < BILL_PROPOSAL_LOW_CONFIDENCE_BELOW;
}

/** A missing per-line score is not a second document score. Null is unknown. */
function lineConfidenceIsLow(value: number | null | undefined): boolean {
  if (value === undefined) return false;
  if (value === null) return true;
  return value < BILL_PROPOSAL_LOW_CONFIDENCE_BELOW;
}

type ParsedProposal = {
  bill: BillProposalPartsInput;
  policy: ExclusionPolicy;
  source: BillScanSource;
  confidence: number | null | undefined;
  lines: BillProposalLineInput[];
  checkIdentity: string | null;
  ambiguousLineItems: boolean;
  cardDataStripped: boolean;
};

function parseInput(input: BillProposalInput): ParsedProposal | BillProposalRefusal {
  if (!isRecord(input) || !isRecord(input.bill) || !isRecord(input.policy)) {
    return refuse('invalid_bill');
  }
  const bill = input.bill;
  const policy = input.policy;
  if (
    !isMoney(bill.grossCents) ||
    !isMoney(bill.taxCents) ||
    !isMoney(bill.tipCents) ||
    !Array.isArray(bill.categoryCents)
  ) {
    return refuse('invalid_bill');
  }
  if (typeof policy.excludeTax !== 'boolean' || typeof policy.excludeTip !== 'boolean') {
    return refuse('invalid_bill');
  }
  if (!Array.isArray(policy.categories) || policy.categories.some((name) => !nonEmptyString(name))) {
    return refuse('invalid_bill');
  }
  for (const category of bill.categoryCents) {
    if (!isRecord(category) || !nonEmptyString(category.name) || !isMoney(category.cents)) {
      return refuse('invalid_bill');
    }
  }

  const meta = input.meta;
  if (meta !== undefined && !isRecord(meta)) return refuse('invalid_bill');
  const source = meta?.source ?? 'manual';
  if (!BILL_SCAN_SOURCES.includes(source)) return refuse('invalid_bill');
  if (meta && !isConfidence(meta.confidence)) return refuse('invalid_bill');
  if (meta?.ambiguousLineItems !== undefined && typeof meta.ambiguousLineItems !== 'boolean') {
    return refuse('invalid_bill');
  }
  if (meta?.cardDataStripped !== undefined && typeof meta.cardDataStripped !== 'boolean') {
    return refuse('invalid_bill');
  }
  if (
    meta?.checkIdentity !== undefined &&
    meta.checkIdentity !== null &&
    typeof meta.checkIdentity !== 'string'
  ) {
    return refuse('invalid_bill');
  }
  if (meta?.lineItems !== undefined && !Array.isArray(meta.lineItems)) {
    return refuse('invalid_bill');
  }
  const lines = meta?.lineItems ?? [];
  for (const line of lines) {
    if (!isRecord(line) || !nonEmptyString(line.label) || !isMoney(line.cents)) {
      return refuse('invalid_bill');
    }
    if (line.category !== undefined && line.category !== null && !nonEmptyString(line.category)) {
      return refuse('invalid_bill');
    }
    if (!isConfidence(line.confidence)) return refuse('invalid_bill');
  }

  return {
    bill: {
      grossCents: bill.grossCents,
      taxCents: bill.taxCents,
      tipCents: bill.tipCents,
      categoryCents: bill.categoryCents.map((category) => ({
        name: category.name,
        cents: category.cents,
      })),
    },
    policy: {
      excludeTax: policy.excludeTax,
      excludeTip: policy.excludeTip,
      categories: [...policy.categories],
    },
    source,
    confidence: meta ? meta.confidence : undefined,
    lines,
    checkIdentity: meta?.checkIdentity ?? null,
    ambiguousLineItems: meta?.ambiguousLineItems === true,
    cardDataStripped: meta?.cardDataStripped === true,
  };
}

function hasNegativeMoney(parsed: ParsedProposal): boolean {
  const parts = [parsed.bill.grossCents, parsed.bill.taxCents, parsed.bill.tipCents];
  if (parts.some((cents) => cents !== null && cents < 0)) return true;
  if (parsed.bill.categoryCents.some((category) => category.cents !== null && category.cents < 0)) {
    return true;
  }
  return parsed.lines.some((line) => line.cents !== null && line.cents < 0);
}

function subtotalIsMissing(parsed: ParsedProposal): boolean {
  const { bill, policy } = parsed;
  if (bill.grossCents === null) return true;
  if (policy.excludeTax && bill.taxCents === null) return true;
  if (policy.excludeTip && bill.tipCents === null) return true;
  return policy.categories.some((name) =>
    bill.categoryCents.some((category) => category.name === name && category.cents === null),
  );
}

function toBillParts(parsed: ParsedProposal): BillParts {
  return {
    grossCents: parsed.bill.grossCents ?? 0,
    taxCents: parsed.bill.taxCents ?? 0,
    tipCents: parsed.bill.tipCents ?? 0,
    categoryCents: parsed.bill.categoryCents.flatMap((category) =>
      category.cents === null ? [] : [{ name: category.name, cents: category.cents }],
    ),
  };
}

/**
 * True when `applyExclusions` had to clamp. A gross one cent higher still
 * clamps only if the excluded cents already exceeded the original gross.
 */
function exclusionsOverflow(bill: BillParts, policy: ExclusionPolicy): boolean {
  const eligible = applyExclusions(bill, policy);
  const lifted = applyExclusions({ ...bill, grossCents: bill.grossCents + 1 }, policy);
  return lifted !== eligible + 1;
}

function linesAreAmbiguous(parsed: ParsedProposal): boolean {
  if (parsed.ambiguousLineItems) return true;
  if (parsed.lines.length === 0) return false;
  if (parsed.lines.some((line) => line.cents === null)) return true;
  if (parsed.bill.grossCents === null) return true;
  let sum = 0;
  for (const line of parsed.lines) sum += line.cents ?? 0;
  // Reconciliation only. A mismatch is a flag. It does not change the proposal.
  const preTaxTip =
    parsed.bill.grossCents - (parsed.bill.taxCents ?? 0) - (parsed.bill.tipCents ?? 0);
  if (sum !== parsed.bill.grossCents && sum !== preTaxTip) return true;
  const byCategory = new Map<string, number>();
  for (const line of parsed.lines) {
    if (!line.category || line.cents === null) continue;
    byCategory.set(line.category, (byCategory.get(line.category) ?? 0) + line.cents);
  }
  for (const category of parsed.bill.categoryCents) {
    if (category.cents === null || !byCategory.has(category.name)) continue;
    if (byCategory.get(category.name) !== category.cents) return true;
  }
  return false;
}

function uncertaintyFlags(parsed: ParsedProposal, missing: boolean): BillUncertaintyFlag[] {
  const present = new Set<BillUncertaintyFlag>();
  if (
    confidenceIsLow(parsed.confidence, parsed.source) ||
    parsed.lines.some((line) => lineConfidenceIsLow(line.confidence))
  ) {
    present.add('low_confidence');
  }
  if (missing) present.add('missing_subtotal');
  if (linesAreAmbiguous(parsed)) present.add('ambiguous_line_items');
  if (parsed.cardDataStripped) present.add('possible_card_data_stripped');
  return BILL_UNCERTAINTY_FLAGS.filter((flag) => present.has(flag));
}

function publishedLines(parsed: ParsedProposal): {
  lines: BillProposalLine[];
  checkIdentity: string | null;
  cardStripped: boolean;
} {
  let cardStripped = false;
  const lines = parsed.lines.map((line) => {
    const label = redactCardRuns(line.label);
    if (label.stripped) cardStripped = true;
    const published: BillProposalLine = { label: label.text, cents: line.cents };
    if (line.category) published.category = line.category;
    if (line.confidence !== undefined) published.confidence = line.confidence;
    return published;
  });
  if (parsed.checkIdentity === null) {
    return { lines, checkIdentity: null, cardStripped };
  }
  const identity = redactCardRuns(parsed.checkIdentity);
  if (identity.stripped) cardStripped = true;
  return { lines, checkIdentity: identity.text, cardStripped };
}

function appliedPolicy(policy: ExclusionPolicy, removedCents: number | null): AppliedBillExclusions {
  return {
    exclude_tax: policy.excludeTax,
    exclude_tip: policy.excludeTip,
    categories: [...policy.categories],
    removed_cents: removedCents,
  };
}

export function proposeBillEligibleSubtotal(input: BillProposalInput): BillProposalResult {
  const parsed = parseInput(input);
  if ('ok' in parsed) return parsed;
  if (hasNegativeMoney(parsed)) return refuse('negative_parts');

  const published = publishedLines(parsed);
  const missing = subtotalIsMissing(parsed);
  const flags = uncertaintyFlags(parsed, missing);
  if (published.cardStripped) flags.push('possible_card_data_stripped');
  const uncertainty_flags = BILL_UNCERTAINTY_FLAGS.filter((flag) => flags.includes(flag));

  const proposal: BillProposal = {
    ok: true,
    proposed_eligible_subtotal_cents: null,
    applied_exclusions: appliedPolicy(parsed.policy, null),
    uncertainty_flags,
    source: parsed.source,
  };
  if (parsed.lines.length > 0) proposal.line_items = published.lines;
  if (published.checkIdentity !== null) proposal.check_identity = published.checkIdentity;

  if (missing) return proposal;
  if (parsed.bill.grossCents !== null && parsed.bill.grossCents >= Number.MAX_SAFE_INTEGER) {
    return refuse('invalid_bill');
  }

  const bill = toBillParts(parsed);
  if (exclusionsOverflow(bill, parsed.policy)) return refuse('exclusion_overflow');
  const proposed = applyExclusions(bill, parsed.policy);
  proposal.proposed_eligible_subtotal_cents = proposed;
  proposal.applied_exclusions = appliedPolicy(parsed.policy, bill.grossCents - proposed);
  return proposal;
}

/**
 * Staff-confirmed integer cents replace the proposal as the amount a later
 * quote may use. The proposal stays on the returned object. Nothing is stored.
 */
export function mergeStaffBillOverride(
  proposal: BillProposalResult,
  confirmedEligibleSubtotalCents: number,
): StaffBillConfirmationResult {
  if (!proposal.ok) return proposal;
  if (!Number.isSafeInteger(confirmedEligibleSubtotalCents)) return refuse('invalid_bill');
  if (confirmedEligibleSubtotalCents < 0) return refuse('negative_parts');
  return {
    ok: true,
    confirmed_eligible_subtotal_cents: confirmedEligibleSubtotalCents,
    proposal,
  };
}
