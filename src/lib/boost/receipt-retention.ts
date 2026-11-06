import { addHours } from 'date-fns';
import { isReceiptObjectPath, receiptRetainDays } from '@/lib/boost/receipt-limits';

/**
 * Elapsed 24-hour days. Not a Chicago calendar date, and not the QR TTL,
 * the 840-hour visit deadline, or credit expiry.
 */
export function receiptRetainUntil(createdAt: Date, retainDays: number): Date {
  return addHours(createdAt, retainDays * 24);
}

export function receiptRetainUntilFromEnv(createdAt: Date, envValue: string | undefined): Date | null {
  const days = receiptRetainDays(envValue);
  if (days === null) return null;
  return receiptRetainUntil(createdAt, days);
}

export type ExpiredReceiptRow = {
  id: string;
  objectPath: string;
};

export type ReceiptCleanupRefusal = 'receipt_cleanup_failed';

/**
 * Deletes stored objects whose `retain_until` has passed and marks the rows.
 * Nothing schedules this. No cron route imports it. It stays off until a
 * later slice turns a job on.
 */
export async function cleanupExpiredReceipts(
  port: {
    listExpired: (
      nowIso: string,
    ) => Promise<{ ok: true; rows: ExpiredReceiptRow[] } | { ok: false; code: 'list_failed' }>;
    removeObjects: (paths: string[]) => Promise<{ ok: true } | { ok: false; code: 'storage_failed' }>;
    markDeleted: (
      ids: string[],
      deletedAtIso: string,
    ) => Promise<{ ok: true } | { ok: false; code: 'store_failed' }>;
  },
  now: Date,
): Promise<{ ok: true; removed: number } | { ok: false; code: ReceiptCleanupRefusal }> {
  const listed = await port.listExpired(now.toISOString());
  if (!listed.ok) return { ok: false, code: 'receipt_cleanup_failed' };
  if (listed.rows.some((row) => !isReceiptObjectPath(row.objectPath))) {
    return { ok: false, code: 'receipt_cleanup_failed' };
  }
  if (listed.rows.length === 0) return { ok: true, removed: 0 };
  const removed = await port.removeObjects(listed.rows.map((row) => row.objectPath));
  if (!removed.ok) return { ok: false, code: 'receipt_cleanup_failed' };
  const marked = await port.markDeleted(
    listed.rows.map((row) => row.id),
    now.toISOString(),
  );
  if (!marked.ok) return { ok: false, code: 'receipt_cleanup_failed' };
  return { ok: true, removed: listed.rows.length };
}

export type MemberReceiptCleanup = {
  listObjectPaths: (
    userId: string,
  ) => Promise<
    { ok: true; paths: string[] } | { ok: false; code: 'missing_table' | 'list_failed' }
  >;
  removeObjects: (paths: string[]) => Promise<{ ok: true } | { ok: false; code: 'storage_failed' }>;
};

/**
 * Deletes this member's receipt objects. `deleteAccount` calls this before
 * `auth.admin.deleteUser`. Rows then drop with the profile. A missing
 * `bill_scan_proposals` relation is skipped so account deletion still works
 * before this migration is applied on hosted. Any other failure stops the
 * account deletion and leaves the user in place.
 */
export async function cleanupMemberReceiptObjects(
  port: MemberReceiptCleanup,
  userId: string,
): Promise<{ ok: true; removed: number } | { ok: false; code: ReceiptCleanupRefusal }> {
  const listed = await port.listObjectPaths(userId);
  if (!listed.ok) {
    if (listed.code === 'missing_table') return { ok: true, removed: 0 };
    return { ok: false, code: 'receipt_cleanup_failed' };
  }
  const prefix = `${userId}/`;
  if (listed.paths.some((path) => !path.startsWith(prefix) || !isReceiptObjectPath(path))) {
    return { ok: false, code: 'receipt_cleanup_failed' };
  }
  if (listed.paths.length === 0) return { ok: true, removed: 0 };
  for (let index = 0; index < listed.paths.length; index += 100) {
    const removed = await port.removeObjects(listed.paths.slice(index, index + 100));
    if (!removed.ok) return { ok: false, code: 'receipt_cleanup_failed' };
  }
  return { ok: true, removed: listed.paths.length };
}

export function isMissingBillScanTable(error: { code?: string | null; message?: string | null }): boolean {
  const code = error.code ?? '';
  if (code === 'PGRST205' || code === '42P01') return true;
  const message = error.message ?? '';
  return /bill_scan_proposals/i.test(message) && /(schema cache|does not exist|could not find the table)/i.test(message);
}
