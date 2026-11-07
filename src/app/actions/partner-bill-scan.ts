'use server';

import { supersedeBoostArrivalQuote } from '@/app/actions/partner-boost-arrival';
import { readAzurePrebuiltReceipt, azureBillScanEnabled } from '@/lib/boost/azure-receipt';
import { createSupabaseArrivalStore } from '@/lib/boost/arrival-store';
import { arrivalSessionsEnabled } from '@/lib/boost/flag';
import {
  mergeStaffBillOverride,
  proposeBillEligibleSubtotal,
  type BillProposalInput,
  type BillScanSource,
  type BillUncertaintyFlag,
} from '@/lib/boost/bill-proposal';
import {
  billScanNeedsManualEntry,
  ilikeExact,
  isStoredBillProposal,
  normalizeGuestEmail,
  parseStoredExclusions,
} from '@/lib/boost/partner-bill-scan';
import { receiptStoragePort } from '@/lib/boost/receipt-admin';
import { RECEIPT_MAX_BYTES, isReceiptContentType, type ReceiptContentType } from '@/lib/boost/receipt-limits';
import { storeBillScanProposal } from '@/lib/boost/receipt-store';
import type { ExclusionPolicy } from '@/lib/offers/calculator';
import { visitWindowOpen } from '@/lib/redemption-expiry';
import { requirePartnerSession } from '@/lib/require-partner-session';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { parseUuid } from '@/lib/uuid';

export type PartnerArrivalItem = {
  challengeItemId: string;
  memberName: string;
  openSessionId: string | null;
};

export type PartnerBillUploadResult =
  | {
      ok: true;
      proposalId: string;
      source: BillScanSource;
      grossCents: number | null;
      proposedEligibleSubtotalCents: number | null;
      confidence: number | null;
      requiresManualEntry: boolean;
      uncertaintyFlags: BillUncertaintyFlag[];
    }
  | { ok: false; code: string };

const AZURE_OBJECT_PATH = 'pending/receipt';

function disabled() {
  return { ok: false as const, code: 'disabled' as const };
}

function forbidden() {
  return { ok: false as const, code: 'forbidden' as const };
}

function manualInput(policy: ExclusionPolicy): BillProposalInput {
  return {
    bill: { grossCents: null, taxCents: null, tipCents: null, categoryCents: [] },
    policy,
    meta: { source: 'manual' },
  };
}

/**
 * In-progress assigned challenge items for one guest at the signed-in
 * restaurant. The restaurant id comes from the partner session.
 * Unset `E07_ARRIVAL_SESSIONS_ENABLED` does not query.
 */
export async function findPartnerArrivalItems(input: { email: string }) {
  if (!arrivalSessionsEnabled()) return disabled();
  const partner = await requirePartnerSession();
  if (!partner.ok) return forbidden();
  const email = normalizeGuestEmail(input.email);
  if (!email) return { ok: false as const, code: 'invalid_email' as const };

  const admin = getSupabaseAdmin();
  const { data: profiles, error: profileError } = await admin
    .from('user_profiles')
    .select('id, full_name, email')
    .ilike('email', ilikeExact(email));
  if (profileError) return { ok: false as const, code: 'unavailable' as const };
  const profile = (profiles ?? []).filter(
    (row) => (row.email ?? '').trim().toLowerCase() === email,
  );
  if (profile.length !== 1) return { ok: true as const, items: [] as PartnerArrivalItem[] };
  const member = profile[0];
  if (!member) return { ok: true as const, items: [] as PartnerArrivalItem[] };

  const { data: cycles, error: cycleError } = await admin
    .from('challenge_cycles')
    .select('id')
    .eq('user_id', member.id);
  if (cycleError) return { ok: false as const, code: 'unavailable' as const };
  const cycleIds = (cycles ?? []).map((row) => row.id);
  if (cycleIds.length === 0) return { ok: true as const, items: [] as PartnerArrivalItem[] };

  const { data: items, error: itemError } = await admin
    .from('challenge_items')
    .select('id, restaurant_id, status, offer_version_id, redemption_deadline, cycle_id')
    .eq('restaurant_id', partner.restaurantId)
    .eq('status', 'assigned')
    .in('cycle_id', cycleIds);
  if (itemError) return { ok: false as const, code: 'unavailable' as const };

  const now = new Date();
  const openItems = (items ?? []).filter(
    (row) =>
      row.restaurant_id === partner.restaurantId &&
      row.status === 'assigned' &&
      row.offer_version_id != null &&
      visitWindowOpen(row.redemption_deadline, now),
  );
  const itemIds = openItems.map((row) => row.id);
  const openSessionByItem = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: sessions, error: sessionError } = await admin
      .from('boost_arrival_sessions')
      .select('id, challenge_item_id, status, restaurant_id')
      .eq('restaurant_id', partner.restaurantId)
      .eq('status', 'open')
      .in('challenge_item_id', itemIds);
    if (sessionError) return { ok: false as const, code: 'unavailable' as const };
    for (const row of sessions ?? []) {
      if (row.restaurant_id !== partner.restaurantId || row.status !== 'open') continue;
      if (!openSessionByItem.has(row.challenge_item_id)) {
        openSessionByItem.set(row.challenge_item_id, row.id);
      }
    }
  }

  const memberName = member.full_name?.trim() || 'Member';
  return {
    ok: true as const,
    items: openItems.map((row) => ({
      challengeItemId: row.id,
      memberName,
      openSessionId: openSessionByItem.get(row.id) ?? null,
    })),
  };
}

function isBinaryUpload(value: FormDataEntryValue | null): value is File {
  if (typeof value !== 'object' || value === null) return false;
  if (!('arrayBuffer' in value) || !('size' in value) || !('type' in value)) return false;
  const file = value as File;
  return typeof file.arrayBuffer === 'function' && typeof file.size === 'number' && typeof file.type === 'string';
}

async function readUpload(value: FormDataEntryValue | null): Promise<
  | { ok: true; bytes: Buffer; contentType: ReceiptContentType }
  | { ok: false; code: 'missing_file' | 'unsupported_type' | 'too_large' }
> {
  if (!isBinaryUpload(value)) return { ok: false, code: 'missing_file' };
  const contentType = value.type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!isReceiptContentType(contentType)) return { ok: false, code: 'unsupported_type' };
  if (value.size > RECEIPT_MAX_BYTES) return { ok: false, code: 'too_large' };
  if (value.size < 1) return { ok: false, code: 'unsupported_type' };
  const bytes = Buffer.from(await value.arrayBuffer());
  if (bytes.length > RECEIPT_MAX_BYTES) return { ok: false, code: 'too_large' };
  if (bytes.length < 1) return { ok: false, code: 'unsupported_type' };
  return { ok: true, bytes, contentType };
}

/**
 * Store one receipt on an open arrival session for this partner restaurant.
 * Azure runs only when `E07_BILL_SCAN_AZURE_ENABLED` is exactly `true`.
 * Otherwise the image is stored and the partner enters the bill.
 * This does not supersede the arrival quote and does not choose a discount.
 */
export async function uploadPartnerBillReceipt(formData: FormData): Promise<PartnerBillUploadResult> {
  if (!arrivalSessionsEnabled()) return disabled();
  const partner = await requirePartnerSession();
  if (!partner.ok) return forbidden();

  const file = await readUpload(formData.get('receipt'));
  if (!file.ok) return file;
  const sessionId = parseUuid(typeof formData.get('sessionId') === 'string' ? String(formData.get('sessionId')) : null);
  if (!sessionId) return { ok: false, code: 'no_open_session' };

  const admin = getSupabaseAdmin();
  const arrival = await createSupabaseArrivalStore(admin).findSession(sessionId, partner.restaurantId);
  if (!arrival || arrival.status !== 'open' || arrival.restaurantId !== partner.restaurantId) {
    return { ok: false, code: 'no_open_session' };
  }

  const [itemResult, versionResult] = await Promise.all([
    admin
      .from('challenge_items')
      .select('id, restaurant_id, cycle_id, offer_version_id')
      .eq('id', arrival.challengeItemId)
      .eq('restaurant_id', partner.restaurantId)
      .maybeSingle(),
    admin
      .from('offer_versions')
      .select('exclusions')
      .eq('id', arrival.offerVersionId)
      .eq('restaurant_id', partner.restaurantId)
      .maybeSingle(),
  ]);
  const item = itemResult.data;
  if (itemResult.error || !item?.cycle_id) return { ok: false, code: 'no_open_session' };

  const { data: cycle, error: cycleError } = await admin
    .from('challenge_cycles')
    .select('user_id')
    .eq('id', item.cycle_id)
    .maybeSingle();
  const memberUserId = parseUuid(cycle?.user_id);
  if (cycleError || !memberUserId) return { ok: false, code: 'unavailable' };

  const version = versionResult.data;
  const versionError = versionResult.error;
  const policy = parseStoredExclusions(version?.exclusions);
  if (versionError || !policy) return { ok: false, code: 'unavailable' };

  let proposalInput = manualInput(policy);
  if (azureBillScanEnabled(process.env.E07_BILL_SCAN_AZURE_ENABLED)) {
    const read = await readAzurePrebuiltReceipt({
      objectPath: AZURE_OBJECT_PATH,
      contentType: file.contentType,
      bytes: file.bytes,
      policy,
    });
    if (read.ok) proposalInput = read.input;
  }

  let proposed = proposeBillEligibleSubtotal(proposalInput);
  if (!proposed.ok && proposalInput.meta?.source !== 'manual') {
    proposalInput = manualInput(policy);
    proposed = proposeBillEligibleSubtotal(proposalInput);
  }
  if (!proposed.ok) return { ok: false, code: proposed.code };

  const stored = await storeBillScanProposal(
    {
      userId: memberUserId,
      restaurantId: partner.restaurantId,
      session: {
        id: arrival.id,
        restaurantId: partner.restaurantId,
        status: 'open',
        memberUserId,
      },
      contentType: file.contentType,
      bytes: file.bytes,
      proposal: proposed,
    },
    receiptStoragePort(admin),
  );
  if (!stored.ok) return { ok: false, code: stored.code };

  const confidence =
    proposalInput.meta?.source === 'azure_prebuilt_receipt' ? (proposalInput.meta.confidence ?? null) : null;
  return {
    ok: true,
    proposalId: stored.row.id,
    source: proposed.source,
    grossCents:
      proposalInput.meta?.source === 'azure_prebuilt_receipt' ? proposalInput.bill.grossCents : null,
    proposedEligibleSubtotalCents: proposed.proposed_eligible_subtotal_cents,
    confidence,
    requiresManualEntry: billScanNeedsManualEntry({
      source: proposed.source,
      confidence,
      proposedEligibleSubtotalCents: proposed.proposed_eligible_subtotal_cents,
      uncertaintyFlags: proposed.uncertainty_flags,
    }),
    uncertaintyFlags: proposed.uncertainty_flags,
  };
}

function parseConfirmedCents(value: number): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/**
 * Partner-confirmed eligible subtotal. Writes that integer on the proposal
 * row when one was uploaded, then supersedes the arrival quote.
 * A scan result never calls this by itself.
 */
export async function confirmPartnerBillSubtotal(input: {
  sessionId: string;
  eligibleSubtotalCents: number;
  proposalId?: string | null;
}) {
  if (!arrivalSessionsEnabled()) return disabled();
  const partner = await requirePartnerSession();
  if (!partner.ok) return forbidden();
  const sessionId = parseUuid(input.sessionId);
  const cents = parseConfirmedCents(input.eligibleSubtotalCents);
  if (!sessionId || cents == null) return { ok: false as const, code: 'invalid_subtotal' as const };

  const proposalId =
    input.proposalId == null || input.proposalId === '' ? null : parseUuid(input.proposalId);
  if (input.proposalId && !proposalId) return { ok: false as const, code: 'not_found' as const };

  if (proposalId) {
    const recorded = await recordConfirmedCents(partner.restaurantId, sessionId, proposalId, cents);
    if (!recorded.ok) return recorded;
  }

  return supersedeBoostArrivalQuote({ sessionId, eligibleSubtotalCents: cents });
}

async function recordConfirmedCents(
  restaurantId: string,
  sessionId: string,
  proposalId: string,
  cents: number,
): Promise<
  | { ok: true }
  | { ok: false; code: 'not_found' | 'invalid_bill' | 'negative_parts' | 'exclusion_overflow' | 'store_failed' }
> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('bill_scan_proposals')
    .select('id, proposal')
    .eq('id', proposalId)
    .eq('restaurant_id', restaurantId)
    .eq('arrival_session_id', sessionId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) return { ok: false, code: 'not_found' };
  if (!isStoredBillProposal(data.proposal)) return { ok: false, code: 'invalid_bill' };
  const merged = mergeStaffBillOverride(data.proposal, cents);
  if (!merged.ok) return { ok: false, code: merged.code };

  const { error: updateError } = await admin
    .from('bill_scan_proposals')
    .update({ confirmed_eligible_subtotal_cents: merged.confirmed_eligible_subtotal_cents })
    .eq('id', proposalId)
    .eq('restaurant_id', restaurantId)
    .eq('arrival_session_id', sessionId)
    .is('deleted_at', null);
  if (updateError) return { ok: false, code: 'store_failed' };
  return { ok: true };
}
