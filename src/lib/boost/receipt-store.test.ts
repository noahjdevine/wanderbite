import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { mergeStaffBillOverride, proposeBillEligibleSubtotal } from '@/lib/boost/bill-proposal';
import { masterPlanEightyTwo } from '@/lib/boost/fixtures/bill-scan';
import { RECEIPT_BUCKET, RECEIPT_SIGNED_URL_TTL_SECONDS, receiptRetainDays } from '@/lib/boost/receipt-limits';
import {
  cleanupExpiredReceipts,
  cleanupMemberReceiptObjects,
  isMissingBillScanTable,
  receiptRetainUntil,
} from '@/lib/boost/receipt-retention';
import {
  mintReceiptSignedUrl,
  storeBillScanProposal,
  type BillScanProposalRow,
  type ReceiptStoragePort,
} from '@/lib/boost/receipt-store';

const ROOT = path.resolve(__dirname, '../../..');
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const RESTAURANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROPOSAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TOKEN = 'SECRET_EXIF_TOKEN';
const A2_SHA256 = '8e2d7c3320818527af506dcfbfe4c2b4089f6fc821a4196d3e724c59fbbfcd21';

function proposal() {
  const result = proposeBillEligibleSubtotal(masterPlanEightyTwo);
  if (!result.ok) throw new Error(result.code);
  return result;
}

function session(status = 'open', restaurantId = RESTAURANT, memberUserId = USER) {
  return { id: SESSION, restaurantId, status, memberUserId };
}

function port(): ReceiptStoragePort & {
  uploads: Array<{ path: string; bytes: Buffer; contentType: string }>;
  rows: BillScanProposalRow[];
  removed: string[][];
  failInsert: boolean;
} {
  const state = {
    uploads: [] as Array<{ path: string; bytes: Buffer; contentType: string }>,
    rows: [] as BillScanProposalRow[],
    removed: [] as string[][],
    failInsert: false,
    async upload(objectPath: string, bytes: Buffer, contentType: string) {
      state.uploads.push({ path: objectPath, bytes, contentType });
      return { ok: true as const };
    },
    async remove(paths: string[]) {
      state.removed.push(paths);
      return { ok: true as const };
    },
    async insert(row: BillScanProposalRow) {
      if (state.failInsert) return { ok: false as const, code: 'store_failed' as const };
      state.rows.push(row);
      return { ok: true as const };
    },
  };
  return state;
}

async function jpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 6, channels: 3, background: { r: 9, g: 8, b: 7 } },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { ImageDescription: TOKEN } } })
    .toBuffer();
}

describe('receipt store', () => {
  it('stores a stripped object path and a seven-day retain_until for an open session', async () => {
    const storage = port();
    const now = new Date('2026-11-06T15:00:00.000Z');
    const stored = await storeBillScanProposal(
      {
        userId: USER,
        restaurantId: RESTAURANT,
        session: session(),
        contentType: 'image/jpeg',
        bytes: await jpeg(),
        proposal: proposal(),
        now,
        createId: () => PROPOSAL_ID,
      },
      storage,
    );
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.row.object_path).toBe(`${USER}/${PROPOSAL_ID}`);
    expect(stored.row.confirmed_eligible_subtotal_cents).toBeNull();
    expect(stored.row.retain_until).toBe('2026-11-13T15:00:00.000Z');
    expect(stored.row.byte_size).toBe(storage.uploads[0].bytes.length);
    expect(JSON.stringify(stored.row)).not.toContain(TOKEN);
    expect(storage.uploads[0].bytes.includes(Buffer.from(TOKEN))).toBe(false);
    expect(storage.uploads[0].contentType).toBe('image/jpeg');
    expect('bytes' in stored.row).toBe(false);
    const confirmed = mergeStaffBillOverride(stored.row.proposal, 8100);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.confirmed_eligible_subtotal_cents).toBe(8100);
    expect(stored.row.confirmed_eligible_subtotal_cents).toBeNull();
    expect(stored.row.proposal.proposed_eligible_subtotal_cents).toBe(8200);
  });

  it('refuses a missing or closed session before any upload', async () => {
    const storage = port();
    const bytes = Buffer.from('not-an-image');
    const missing = await storeBillScanProposal(
      {
        userId: USER,
        restaurantId: RESTAURANT,
        session: null,
        contentType: 'image/jpeg',
        bytes,
        proposal: proposal(),
      },
      storage,
    );
    const closed = await storeBillScanProposal(
      {
        userId: USER,
        restaurantId: RESTAURANT,
        session: session('closed'),
        contentType: 'image/jpeg',
        bytes,
        proposal: proposal(),
      },
      storage,
    );
    const mismatch = await storeBillScanProposal(
      {
        userId: USER,
        restaurantId: RESTAURANT,
        session: session('open', RESTAURANT, OTHER),
        contentType: 'image/jpeg',
        bytes,
        proposal: proposal(),
      },
      storage,
    );
    expect(missing).toEqual({ ok: false, code: 'no_open_session' });
    expect(closed).toEqual({ ok: false, code: 'no_open_session' });
    expect(mismatch).toEqual({ ok: false, code: 'session_mismatch' });
    expect(storage.uploads).toEqual([]);
    expect(storage.rows).toEqual([]);
  });

  it('removes the object when the row insert fails', async () => {
    const storage = port();
    storage.failInsert = true;
    const stored = await storeBillScanProposal(
      {
        userId: USER,
        restaurantId: RESTAURANT,
        session: session(),
        contentType: 'image/jpeg',
        bytes: await jpeg(),
        proposal: proposal(),
        createId: () => PROPOSAL_ID,
      },
      storage,
    );
    expect(stored).toEqual({ ok: false, code: 'store_failed' });
    expect(storage.removed).toEqual([[`${USER}/${PROPOSAL_ID}`]]);
    expect(storage.rows).toEqual([]);
  });

  it('mints a five-minute signed URL and does not accept a raw object key from nowhere', async () => {
    let ttl = 0;
    const signed = await mintReceiptSignedUrl(`${USER}/${PROPOSAL_ID}`, async (_path, expiresIn) => {
      ttl = expiresIn;
      return { ok: true, url: 'https://storage.example/signed' };
    });
    expect(signed).toEqual({
      ok: true,
      url: 'https://storage.example/signed',
      expiresIn: RECEIPT_SIGNED_URL_TTL_SECONDS,
    });
    expect(ttl).toBe(300);
    expect(await mintReceiptSignedUrl('https://evil.example/object', async () => ({ ok: true, url: 'nope' }))).toEqual({
      ok: false,
      code: 'storage_failed',
    });
  });
});

describe('receipt retention and account cleanup', () => {
  it('keeps the default at seven elapsed days and rejects a bad setting', () => {
    expect(receiptRetainDays(undefined)).toBe(7);
    expect(receiptRetainDays('')).toBe(7);
    expect(receiptRetainDays('14')).toBe(14);
    expect(receiptRetainDays('0')).toBeNull();
    expect(receiptRetainDays('7abc')).toBeNull();
    const created = new Date('2026-11-06T15:00:00.000Z');
    expect(receiptRetainUntil(created, 7).toISOString()).toBe('2026-11-13T15:00:00.000Z');
    expect(receiptRetainUntil(created, 7).getTime() - created.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('deletes expired objects only through the unused helper', async () => {
    const removed: string[][] = [];
    const marked: string[][] = [];
    const result = await cleanupExpiredReceipts(
      {
        async listExpired() {
          return { ok: true, rows: [{ id: PROPOSAL_ID, objectPath: `${USER}/${PROPOSAL_ID}` }] };
        },
        async removeObjects(paths) {
          removed.push(paths);
          return { ok: true };
        },
        async markDeleted(ids) {
          marked.push(ids);
          return { ok: true };
        },
      },
      new Date('2026-11-20T00:00:00.000Z'),
    );
    expect(result).toEqual({ ok: true, removed: 1 });
    expect(removed).toEqual([[`${USER}/${PROPOSAL_ID}`]]);
    expect(marked).toEqual([[PROPOSAL_ID]]);

    const failed = await cleanupExpiredReceipts(
      {
        async listExpired() {
          return { ok: true, rows: [{ id: PROPOSAL_ID, objectPath: `${USER}/${PROPOSAL_ID}` }] };
        },
        async removeObjects() {
          return { ok: false, code: 'storage_failed' };
        },
        async markDeleted() {
          throw new Error('should not mark');
        },
      },
      new Date('2026-11-20T00:00:00.000Z'),
    );
    expect(failed).toEqual({ ok: false, code: 'receipt_cleanup_failed' });
  });

  it('stops account deletion when receipt objects cannot be removed, and skips a missing table', async () => {
    const removed: string[][] = [];
    const ok = await cleanupMemberReceiptObjects(
      {
        async listObjectPaths() {
          return { ok: true, paths: [`${USER}/${PROPOSAL_ID}`] };
        },
        async removeObjects(paths) {
          removed.push(paths);
          return { ok: true };
        },
      },
      USER,
    );
    expect(ok).toEqual({ ok: true, removed: 1 });
    expect(removed).toEqual([[`${USER}/${PROPOSAL_ID}`]]);

    const skipped = await cleanupMemberReceiptObjects(
      {
        async listObjectPaths() {
          return { ok: false, code: 'missing_table' };
        },
        async removeObjects() {
          throw new Error('should not remove');
        },
      },
      USER,
    );
    expect(skipped).toEqual({ ok: true, removed: 0 });

    const blocked = await cleanupMemberReceiptObjects(
      {
        async listObjectPaths() {
          return { ok: true, paths: [`${USER}/${PROPOSAL_ID}`] };
        },
        async removeObjects() {
          return { ok: false, code: 'storage_failed' };
        },
      },
      USER,
    );
    expect(blocked).toEqual({ ok: false, code: 'receipt_cleanup_failed' });
    expect(isMissingBillScanTable({ code: 'PGRST205', message: 'bill_scan_proposals' })).toBe(true);
    expect(isMissingBillScanTable({ code: '42501', message: 'permission denied' })).toBe(false);
  });

  it('wires deleteAccount ahead of auth deletion and leaves flags and pages alone', () => {
    const auth = readFileSync(path.join(ROOT, 'src/app/actions/auth.ts'), 'utf8');
    const cleanupAt = auth.indexOf('cleanupMemberReceiptObjects');
    const deleteAt = auth.indexOf('admin.auth.admin.deleteUser');
    expect(cleanupAt).toBeGreaterThan(0);
    expect(deleteAt).toBeGreaterThan(cleanupAt);
    expect(auth).not.toMatch(/quoteBoost|E07_BILL_SCAN_AZURE_ENABLED|E07_ARRIVAL_SESSIONS_ENABLED/);

    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || name.endsWith('.test.ts')) continue;
        if (full.endsWith(`${path.sep}auth.ts`)) continue;
        if (full.endsWith(`${path.sep}partner-bill-scan.ts`)) continue;
        const text = readFileSync(full, 'utf8');
        if (
          text.includes('storeBillScanProposal') ||
          text.includes('readAzurePrebuiltReceipt') ||
          text.includes('mintReceiptSignedUrl') ||
          text.includes('cleanupExpiredReceipts') ||
          text.includes(RECEIPT_BUCKET)
        ) {
          hits.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, 'src/app'));
    walk(path.join(ROOT, 'src/components'));
    expect(hits).toEqual([]);

    const billScan = readFileSync(path.join(ROOT, 'src/app/actions/partner-bill-scan.ts'), 'utf8');
    expect(billScan).toMatch(/storeBillScanProposal/);
    expect(billScan).toMatch(/readAzurePrebuiltReceipt/);
    expect(billScan).toMatch(/azureBillScanEnabled|E07_BILL_SCAN_AZURE_ENABLED/);
    expect(billScan).not.toMatch(/E07_BILL_SCAN_AZURE_ENABLED\s*=\s*'true'/);
    expect(billScan).not.toMatch(/\bquoteBoost\s*\(/);

    const vercel = readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
    const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(vercel).not.toContain('E07_BILL_SCAN_AZURE_ENABLED');
    expect(vercel).not.toContain('bill-receipts');
    expect(ci).not.toMatch(/E07_BILL_SCAN_AZURE_ENABLED:\s*true/);
    expect(ci).not.toMatch(/E07_ARRIVAL_SESSIONS_ENABLED:\s*true/);

    const renamed = readFileSync(
      path.join(ROOT, 'supabase/migrations/20261106034025_e07_a2_arrival_sessions.sql'),
    );
    expect(createHash('sha256').update(renamed).digest('hex')).toBe(A2_SHA256);
    expect(readdirSync(path.join(ROOT, 'supabase/migrations'))).not.toContain(
      '20261106030525_e07_a2_arrival_sessions.sql',
    );
  });
});
