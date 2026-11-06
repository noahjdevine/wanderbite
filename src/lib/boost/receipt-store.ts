import { randomUUID } from 'node:crypto';
import type { BillProposal } from '@/lib/boost/bill-proposal';
import { prepareReceiptObject } from '@/lib/boost/receipt-image';
import type { ReceiptImageRefusal } from '@/lib/boost/receipt-image';
import {
  RECEIPT_SIGNED_URL_TTL_SECONDS,
  isUuid,
  receiptObjectPath,
  receiptRetainDays,
} from '@/lib/boost/receipt-limits';
import { receiptRetainUntil } from '@/lib/boost/receipt-retention';

export type ReceiptArrivalSession = {
  id: string;
  restaurantId: string;
  status: string;
  /** Member who owns the challenge item on this session. */
  memberUserId: string;
};

export type BillScanProposalRow = {
  id: string;
  user_id: string;
  restaurant_id: string;
  arrival_session_id: string;
  object_path: string;
  content_type: string;
  byte_size: number;
  width: number;
  height: number;
  source: BillProposal['source'];
  proposal: BillProposal;
  confirmed_eligible_subtotal_cents: null;
  created_at: string;
  retain_until: string;
  deleted_at: null;
};

export type ReceiptStoragePort = {
  upload: (
    objectPath: string,
    bytes: Buffer,
    contentType: string,
  ) => Promise<{ ok: true } | { ok: false; code: 'storage_failed' }>;
  remove: (objectPaths: string[]) => Promise<{ ok: true } | { ok: false; code: 'storage_failed' }>;
  insert: (row: BillScanProposalRow) => Promise<{ ok: true } | { ok: false; code: 'store_failed' }>;
};

export const RECEIPT_STORE_REFUSALS = [
  'no_open_session',
  'session_mismatch',
  'invalid_retention',
  'storage_failed',
  'store_failed',
] as const;

export type ReceiptStoreRefusal =
  | (typeof RECEIPT_STORE_REFUSALS)[number]
  | ReceiptImageRefusal;

export type StoreBillScanInput = {
  userId: string;
  restaurantId: string;
  session: ReceiptArrivalSession | null;
  contentType: string;
  bytes: Buffer;
  proposal: BillProposal;
  /** `E07_RECEIPT_RETAIN_DAYS`. Omitted uses 7. */
  retainDaysEnv?: string;
  now?: Date;
  createId?: () => string;
};

export type StoreBillScanResult =
  | { ok: true; row: BillScanProposalRow }
  | { ok: false; code: ReceiptStoreRefusal };

/**
 * Validates an open arrival session, strips metadata, uploads the object,
 * and inserts a proposal row. Image bytes stay in the bucket. The row stores
 * `object_path` only. `confirmed_eligible_subtotal_cents` stays null.
 * This does not call `quoteBoost`.
 */
export async function storeBillScanProposal(
  input: StoreBillScanInput,
  port: ReceiptStoragePort,
): Promise<StoreBillScanResult> {
  const session = openSession(input);
  if (!session.ok) return session;
  const days = receiptRetainDays(input.retainDaysEnv);
  if (days === null) return { ok: false, code: 'invalid_retention' };
  const prepared = await prepareReceiptObject(input.bytes, input.contentType);
  if (!prepared.ok) return prepared;
  const id = input.createId?.() ?? randomUUID();
  const objectPath = receiptObjectPath(input.userId, id);
  if (!objectPath || !isUuid(input.restaurantId) || !isUuid(session.session.id)) {
    return { ok: false, code: 'store_failed' };
  }
  const now = input.now ?? new Date();
  const row: BillScanProposalRow = {
    id,
    user_id: input.userId,
    restaurant_id: input.restaurantId,
    arrival_session_id: session.session.id,
    object_path: objectPath,
    content_type: prepared.contentType,
    byte_size: prepared.byteSize,
    width: prepared.width,
    height: prepared.height,
    source: input.proposal.source,
    proposal: structuredClone(input.proposal),
    confirmed_eligible_subtotal_cents: null,
    created_at: now.toISOString(),
    retain_until: receiptRetainUntil(now, days).toISOString(),
    deleted_at: null,
  };
  const uploaded = await port.upload(objectPath, prepared.bytes, prepared.contentType);
  if (!uploaded.ok) return { ok: false, code: 'storage_failed' };
  const inserted = await port.insert(row);
  if (!inserted.ok) {
    await port.remove([objectPath]);
    return { ok: false, code: 'store_failed' };
  }
  return { ok: true, row };
}

export function openSession(
  input: Pick<StoreBillScanInput, 'userId' | 'restaurantId' | 'session'>,
): { ok: true; session: ReceiptArrivalSession } | { ok: false; code: 'no_open_session' | 'session_mismatch' } {
  if (!input.session || input.session.status !== 'open') {
    return { ok: false, code: 'no_open_session' };
  }
  if (input.session.restaurantId !== input.restaurantId || input.session.memberUserId !== input.userId) {
    return { ok: false, code: 'session_mismatch' };
  }
  return { ok: true, session: input.session };
}

/** Short-lived server URL. Callers must not hand this to the member client. */
export async function mintReceiptSignedUrl(
  objectPath: string,
  sign: (
    path: string,
    ttlSeconds: number,
  ) => Promise<{ ok: true; url: string } | { ok: false; code: 'storage_failed' }>,
): Promise<{ ok: true; url: string; expiresIn: number } | { ok: false; code: 'storage_failed' }> {
  const slash = objectPath.indexOf('/');
  if (slash <= 0 || !isUuid(objectPath.slice(0, slash)) || !isUuid(objectPath.slice(slash + 1))) {
    return { ok: false, code: 'storage_failed' };
  }
  const signed = await sign(objectPath, RECEIPT_SIGNED_URL_TTL_SECONDS);
  if (!signed.ok) return signed;
  return { ok: true, url: signed.url, expiresIn: RECEIPT_SIGNED_URL_TTL_SECONDS };
}
