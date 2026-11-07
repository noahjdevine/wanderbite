import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database.types';
import type { BillScanProposalRow, ReceiptStoragePort } from '@/lib/boost/receipt-store';
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

/**
 * Service-role upload and insert for one proposal. Object bytes stay in
 * `bill-receipts`. Callers pass this to `storeBillScanProposal`.
 */
export function receiptStoragePort(admin: Admin): ReceiptStoragePort {
  return {
    async upload(objectPath, bytes, contentType) {
      try {
        const { error } = await admin.storage.from(RECEIPT_BUCKET).upload(objectPath, bytes, {
          contentType,
          upsert: false,
        });
        if (error) return { ok: false, code: 'storage_failed' };
        return { ok: true };
      } catch {
        return { ok: false, code: 'storage_failed' };
      }
    },
    async remove(objectPaths) {
      try {
        const { error } = await admin.storage.from(RECEIPT_BUCKET).remove(objectPaths);
        if (error) return { ok: false, code: 'storage_failed' };
        return { ok: true };
      } catch {
        return { ok: false, code: 'storage_failed' };
      }
    },
    async insert(row: BillScanProposalRow) {
      try {
        const { error } = await admin.from('bill_scan_proposals').insert({
          id: row.id,
          user_id: row.user_id,
          restaurant_id: row.restaurant_id,
          arrival_session_id: row.arrival_session_id,
          object_path: row.object_path,
          content_type: row.content_type,
          byte_size: row.byte_size,
          width: row.width,
          height: row.height,
          source: row.source,
          proposal: row.proposal as unknown as Json,
          confirmed_eligible_subtotal_cents: null,
          created_at: row.created_at,
          retain_until: row.retain_until,
          deleted_at: null,
        });
        if (error) return { ok: false, code: 'store_failed' };
        return { ok: true };
      } catch {
        return { ok: false, code: 'store_failed' };
      }
    },
  };
}
