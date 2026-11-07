import {
  BILL_PROPOSAL_LOW_CONFIDENCE_BELOW,
  BILL_SCAN_SOURCES,
  BILL_UNCERTAINTY_FLAGS,
  type BillProposal,
  type BillScanSource,
  type BillUncertaintyFlag,
} from '@/lib/boost/bill-proposal';
import type { ExclusionPolicy } from '@/lib/offers/calculator';

const SOURCES = new Set<string>(BILL_SCAN_SOURCES);
const FLAGS = new Set<string>(BILL_UNCERTAINTY_FLAGS);

/**
 * The scan may display a total. It is not a confirmed subtotal when this is
 * true. The partner types the amount, or confirms only when this is false.
 * The 0.8 cutoff is `BILL_PROPOSAL_LOW_CONFIDENCE_BELOW`.
 */
export function billScanNeedsManualEntry(input: {
  source: BillScanSource;
  confidence: number | null | undefined;
  proposedEligibleSubtotalCents: number | null;
  uncertaintyFlags: readonly string[];
}): boolean {
  if (input.source !== 'azure_prebuilt_receipt') return true;
  if (input.proposedEligibleSubtotalCents == null) return true;
  if (input.uncertaintyFlags.includes('low_confidence')) return true;
  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence)) return true;
  if (input.confidence < BILL_PROPOSAL_LOW_CONFIDENCE_BELOW) return true;
  return false;
}

export function parseStoredExclusions(value: unknown): ExclusionPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.exclude_tax !== 'boolean' || typeof row.exclude_tip !== 'boolean') return null;
  if (!Array.isArray(row.categories)) return null;
  const categories: string[] = [];
  for (const name of row.categories) {
    if (typeof name !== 'string' || name.trim().length === 0) return null;
    categories.push(name);
  }
  return {
    excludeTax: row.exclude_tax,
    excludeTip: row.exclude_tip,
    categories,
  };
}

export function isStoredBillProposal(value: unknown): value is BillProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as BillProposal;
  if (row.ok !== true) return false;
  if (!SOURCES.has(row.source)) return false;
  const cents = row.proposed_eligible_subtotal_cents;
  if (cents !== null && (typeof cents !== 'number' || !Number.isSafeInteger(cents))) return false;
  if (!Array.isArray(row.uncertainty_flags)) return false;
  if (row.uncertainty_flags.some((flag) => !FLAGS.has(flag))) return false;
  return true;
}

/** Guest lookup. Rejects blank, spaces, and LIKE wildcards. */
export function normalizeGuestEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320) return null;
  if (/[\s%\\]/.test(email)) return null;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return null;
  return email;
}

/** Exact `ILIKE` pattern. `_` in an email is not a single-character wildcard. */
export function ilikeExact(email: string): string {
  return email.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function isUncertaintyFlag(value: string): value is BillUncertaintyFlag {
  return FLAGS.has(value);
}
