import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import { RECEIPT_BUCKET } from '@/lib/boost/receipt-limits';
import {
  isMissingBillScanTable,
  type MemberReceiptCleanup,
} from '@/lib/boost/receipt-retention';

type Admin = SupabaseClient<Database>;

/**
 * Service-role reads of `bill_scan_proposals.object_path` and deletes in
 * `bill-receipts`. A missing table is reported as `missing_table` so account
 * deletion can continue before the migration is on hosted.
 */
export function memberReceiptCleanupPort(admin: Admin): MemberReceiptCleanup {
  return {
    async listObjectPaths(userId) {
      try {
        const { data, error } = await admin
          .from('bill_scan_proposals')
          .select('object_path')
          .eq('user_id', userId)
          .is('deleted_at', null);
        if (error) {
          if (isMissingBillScanTable(error)) return { ok: false, code: 'missing_table' };
          return { ok: false, code: 'list_failed' };
        }
        const paths = (data ?? []).map((row) => row.object_path);
        return { ok: true, paths };
      } catch {
        return { ok: false, code: 'list_failed' };
      }
    },
    async removeObjects(paths) {
      try {
        const { error } = await admin.storage.from(RECEIPT_BUCKET).remove(paths);
        if (error) return { ok: false, code: 'storage_failed' };
        return { ok: true };
      } catch {
        return { ok: false, code: 'storage_failed' };
      }
    },
  };
}
