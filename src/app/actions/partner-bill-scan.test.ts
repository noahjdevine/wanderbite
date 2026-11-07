import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requirePartnerSession = vi.fn();
const findSession = vi.fn();
const storeBillScanProposal = vi.fn();
const readAzure = vi.fn();
const supersede = vi.fn();
const getSupabaseAdmin = vi.fn();

vi.mock('@/lib/require-partner-session', () => ({
  requirePartnerSession: (...args: unknown[]) => requirePartnerSession(...args),
}));

vi.mock('@/lib/boost/arrival-store', () => ({
  createSupabaseArrivalStore: () => ({
    findSession: (...args: unknown[]) => findSession(...args),
  }),
}));

vi.mock('@/lib/boost/receipt-store', () => ({
  storeBillScanProposal: (...args: unknown[]) => storeBillScanProposal(...args),
}));

vi.mock('@/lib/boost/azure-receipt', async () => {
  const actual = await vi.importActual<typeof import('@/lib/boost/azure-receipt')>('@/lib/boost/azure-receipt');
  return {
    ...actual,
    readAzurePrebuiltReceipt: (...args: unknown[]) => readAzure(...args),
  };
});

vi.mock('@/app/actions/partner-boost-arrival', () => ({
  supersedeBoostArrivalQuote: (...args: unknown[]) => supersede(...args),
}));

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => getSupabaseAdmin(),
}));

import {
  confirmPartnerBillSubtotal,
  findPartnerArrivalItems,
  uploadPartnerBillReceipt,
} from '@/app/actions/partner-bill-scan';

const RESTAURANT = '11111111-1111-4111-8111-111111111111';
const SESSION = '55555555-5555-4555-8555-555555555555';
const ITEM = '44444444-4444-4444-8444-444444444444';
const USER = '33333333-3333-4333-8333-333333333333';
const CYCLE = '66666666-6666-4666-8666-666666666666';
const VERSION = '77777777-7777-4777-8777-777777777777';
const PROPOSAL = '88888888-8888-4888-8888-888888888888';
const HASH = 'ab'.repeat(32);
const ROOT = path.resolve(__dirname, '../../..');

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {};
const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];

function adminMock() {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let mode: 'select' | 'update' = 'select';
      let patch: Record<string, unknown> | null = null;
      const run = () => {
        const matched = (tables[table] ?? []).filter((row) => filters.every((fn) => fn(row)));
        if (mode === 'update' && patch) {
          updates.push({ table, patch });
          for (const row of matched) Object.assign(row, patch);
        }
        return { data: matched, error: null };
      };
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        in(column: string, values: readonly unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        ilike(column: string, pattern: string) {
          const expected = pattern.replace(/\\([\\%_])/g, '$1').toLowerCase();
          filters.push((row) => String(row[column] ?? '').trim().toLowerCase() === expected);
          return builder;
        },
        is(column: string, value: unknown) {
          filters.push((row) => (value === null ? row[column] == null : row[column] === value));
          return builder;
        },
        update(value: Record<string, unknown>) {
          mode = 'update';
          patch = value;
          return builder;
        },
        maybeSingle: async () => {
          const result = run();
          return { data: result.data[0] ?? null, error: null };
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function seedVisit() {
  tables.user_profiles = [{ id: USER, email: 'ada@example.com', full_name: 'Ada Guest' }];
  tables.challenge_cycles = [{ id: CYCLE, user_id: USER }];
  tables.challenge_items = [
    {
      id: ITEM,
      restaurant_id: RESTAURANT,
      status: 'assigned',
      offer_version_id: VERSION,
      redemption_deadline: '2026-12-31T00:00:00.000Z',
      cycle_id: CYCLE,
    },
  ];
  tables.offer_versions = [
    {
      id: VERSION,
      restaurant_id: RESTAURANT,
      exclusions: { exclude_tax: true, exclude_tip: true, categories: [] },
    },
  ];
  tables.boost_arrival_sessions = [
    { id: SESSION, challenge_item_id: ITEM, status: 'open', restaurant_id: RESTAURANT },
  ];
  tables.bill_scan_proposals = [
    {
      id: PROPOSAL,
      restaurant_id: RESTAURANT,
      arrival_session_id: SESSION,
      deleted_at: null,
      proposal: {
        ok: true,
        proposed_eligible_subtotal_cents: 8200,
        uncertainty_flags: [],
        source: 'azure_prebuilt_receipt',
        applied_exclusions: { exclude_tax: true, exclude_tip: true, categories: [] },
      },
    },
  ];
}

function openSession() {
  findSession.mockResolvedValue({
    id: SESSION,
    restaurantId: RESTAURANT,
    challengeItemId: ITEM,
    offerVersionId: VERSION,
    redemptionId: null,
    lockedBoostId: null,
    arrivalAt: '2026-11-07T18:00:00.000Z',
    expiresAt: '2026-11-07T22:00:00.000Z',
    idempotencyKey: `e07-arrival:${ITEM}`,
    status: 'open',
  });
}

function receiptForm(type = 'image/jpeg', size = 4, sessionId = SESSION) {
  const file = new File([new Uint8Array(Math.min(size, 16))], 'receipt.jpg', { type });
  if (file.size !== size) Object.defineProperty(file, 'size', { value: size });
  const body = new FormData();
  body.set('sessionId', sessionId);
  body.set('receipt', file);
  return body;
}

function azureRead(confidence: number, lineConfidence?: number) {
  return {
    ok: true as const,
    input: {
      bill: { grossCents: 10000, taxCents: 800, tipCents: 1000, categoryCents: [] },
      policy: { excludeTax: true, excludeTip: true, categories: [] },
      meta: {
        source: 'azure_prebuilt_receipt' as const,
        confidence,
        ...(lineConfidence === undefined
          ? {}
          : {
              lineItems: [{ label: 'Food', cents: 8200, confidence: lineConfidence }],
            }),
      },
    },
  };
}

describe('partner bill scan actions', () => {
  beforeEach(() => {
    requirePartnerSession.mockReset();
    findSession.mockReset();
    storeBillScanProposal.mockReset();
    readAzure.mockReset();
    supersede.mockReset();
    getSupabaseAdmin.mockReset();
    for (const key of Object.keys(tables)) delete tables[key];
    updates.length = 0;
    delete process.env.E07_ARRIVAL_SESSIONS_ENABLED;
    delete process.env.E07_BILL_SCAN_AZURE_ENABLED;
    requirePartnerSession.mockResolvedValue({
      ok: true,
      restaurantId: RESTAURANT,
      restaurantName: 'Grill',
      tokenHash: HASH,
    });
    getSupabaseAdmin.mockImplementation(adminMock);
    storeBillScanProposal.mockResolvedValue({ ok: true, row: { id: PROPOSAL } });
    supersede.mockResolvedValue({
      ok: true,
      quote: { totalDiscountCents: 1000, belowMinimum: false, eligibleSubtotalCents: 8200 },
    });
    seedVisit();
    openSession();
  });

  it('does not query when the arrival flag is unset', async () => {
    process.env.E07_BILL_SCAN_AZURE_ENABLED = 'true';
    await expect(findPartnerArrivalItems({ email: 'ada@example.com' })).resolves.toEqual({
      ok: false,
      code: 'disabled',
    });
    await expect(uploadPartnerBillReceipt(receiptForm())).resolves.toEqual({ ok: false, code: 'disabled' });
    await expect(
      confirmPartnerBillSubtotal({ sessionId: SESSION, eligibleSubtotalCents: 8200, proposalId: PROPOSAL }),
    ).resolves.toEqual({ ok: false, code: 'disabled' });
    expect(requirePartnerSession).not.toHaveBeenCalled();
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(findSession).not.toHaveBeenCalled();
    expect(storeBillScanProposal).not.toHaveBeenCalled();
    expect(readAzure).not.toHaveBeenCalled();
    expect(supersede).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not the partner', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    process.env.E07_BILL_SCAN_AZURE_ENABLED = 'true';
    requirePartnerSession.mockResolvedValue({ ok: false });
    await expect(uploadPartnerBillReceipt(receiptForm())).resolves.toEqual({ ok: false, code: 'forbidden' });
    await expect(findPartnerArrivalItems({ email: 'ada@example.com' })).resolves.toEqual({
      ok: false,
      code: 'forbidden',
    });
    await expect(
      confirmPartnerBillSubtotal({ sessionId: SESSION, eligibleSubtotalCents: 8200 }),
    ).resolves.toEqual({ ok: false, code: 'forbidden' });
    expect(findSession).not.toHaveBeenCalled();
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
    expect(storeBillScanProposal).not.toHaveBeenCalled();
    expect(readAzure).not.toHaveBeenCalled();
    expect(supersede).not.toHaveBeenCalled();
  });

  it('refuses an upload when there is no open session for this restaurant', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    process.env.E07_BILL_SCAN_AZURE_ENABLED = 'true';
    findSession.mockResolvedValue(null);
    await expect(uploadPartnerBillReceipt(receiptForm())).resolves.toEqual({
      ok: false,
      code: 'no_open_session',
    });
    expect(findSession).toHaveBeenCalledWith(SESSION, RESTAURANT);
    expect(storeBillScanProposal).not.toHaveBeenCalled();
    expect(readAzure).not.toHaveBeenCalled();
    expect(supersede).not.toHaveBeenCalled();

    findSession.mockResolvedValue({
      id: SESSION,
      restaurantId: RESTAURANT,
      challengeItemId: ITEM,
      offerVersionId: VERSION,
      status: 'closed',
    });
    await expect(uploadPartnerBillReceipt(receiptForm())).resolves.toEqual({
      ok: false,
      code: 'no_open_session',
    });
    expect(storeBillScanProposal).not.toHaveBeenCalled();
    expect(readAzure).not.toHaveBeenCalled();
  });

  it('refuses an oversize or wrong-type image before storage or Azure', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    process.env.E07_BILL_SCAN_AZURE_ENABLED = 'true';
    await expect(uploadPartnerBillReceipt(receiptForm('image/jpeg', 10_000_001))).resolves.toEqual({
      ok: false,
      code: 'too_large',
    });
    await expect(uploadPartnerBillReceipt(receiptForm('image/gif', 4))).resolves.toEqual({
      ok: false,
      code: 'unsupported_type',
    });
    expect(findSession).not.toHaveBeenCalled();
    expect(storeBillScanProposal).not.toHaveBeenCalled();
    expect(readAzure).not.toHaveBeenCalled();
    expect(supersede).not.toHaveBeenCalled();
  });

  it('stores a manual proposal and skips Azure when the Azure flag is unset', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
    const stored = await uploadPartnerBillReceipt(receiptForm('image/heic', 8));
    expect(stored).toMatchObject({
      ok: true,
      proposalId: PROPOSAL,
      source: 'manual',
      grossCents: null,
      proposedEligibleSubtotalCents: null,
      confidence: null,
      requiresManualEntry: true,
    });
    expect(readAzure).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(supersede).not.toHaveBeenCalled();
    expect(storeBillScanProposal).toHaveBeenCalledTimes(1);
    const input = storeBillScanProposal.mock.calls[0]?.[0] as {
      restaurantId: string;
      userId: string;
      proposal: { source: string };
    };
    expect(input.restaurantId).toBe(RESTAURANT);
    expect(input.userId).toBe(USER);
    expect(input.proposal.source).toBe('manual');
    fetchSpy.mockRestore();
  });

  it('shows a high-confidence Azure total and does not apply a discount', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    process.env.E07_BILL_SCAN_AZURE_ENABLED = 'true';
    readAzure.mockResolvedValue(azureRead(0.95));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
    const stored = await uploadPartnerBillReceipt(receiptForm());
    expect(stored).toMatchObject({
      ok: true,
      source: 'azure_prebuilt_receipt',
      grossCents: 10000,
      proposedEligibleSubtotalCents: 8200,
      confidence: 0.95,
      requiresManualEntry: false,
      uncertaintyFlags: [],
    });
    expect(readAzure).toHaveBeenCalledTimes(1);
    const azureInput = readAzure.mock.calls[0]?.[0] as { contentType: string; objectPath: string };
    expect(azureInput.contentType).toBe('image/jpeg');
    expect(azureInput.objectPath).not.toMatch(/https?:/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(supersede).not.toHaveBeenCalled();
    const proposal = storeBillScanProposal.mock.calls[0]?.[0] as { proposal: { source: string } };
    expect(proposal.proposal.source).toBe('azure_prebuilt_receipt');
    fetchSpy.mockRestore();
  });

  it('keeps a parsed total that is under the 0.8 cutoff for manual entry', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    process.env.E07_BILL_SCAN_AZURE_ENABLED = 'true';
    readAzure.mockResolvedValue(azureRead(0.5));
    const low = await uploadPartnerBillReceipt(receiptForm());
    expect(low).toMatchObject({
      ok: true,
      grossCents: 10000,
      proposedEligibleSubtotalCents: 8200,
      confidence: 0.5,
      requiresManualEntry: true,
      uncertaintyFlags: ['low_confidence'],
    });
    expect(supersede).not.toHaveBeenCalled();

    readAzure.mockResolvedValue(azureRead(0.8));
    const exact = await uploadPartnerBillReceipt(receiptForm());
    expect(exact).toMatchObject({ confidence: 0.8, requiresManualEntry: false });

    readAzure.mockResolvedValue(azureRead(0.95, 0.2));
    const line = await uploadPartnerBillReceipt(receiptForm());
    expect(line).toMatchObject({
      confidence: 0.95,
      requiresManualEntry: true,
      uncertaintyFlags: expect.arrayContaining(['low_confidence']),
    });
    expect(supersede).not.toHaveBeenCalled();
  });

  it('lists only this restaurant in-progress item and confirms an entered amount', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    const found = await findPartnerArrivalItems({ email: 'Ada@Example.com' });
    expect(found).toEqual({
      ok: true,
      items: [{ challengeItemId: ITEM, memberName: 'Ada Guest', openSessionId: SESSION }],
    });

    tables.challenge_items = [
      {
        id: ITEM,
        restaurant_id: '22222222-2222-4222-8222-222222222222',
        status: 'assigned',
        offer_version_id: VERSION,
        redemption_deadline: '2026-12-31T00:00:00.000Z',
        cycle_id: CYCLE,
      },
    ];
    await expect(findPartnerArrivalItems({ email: 'ada@example.com' })).resolves.toEqual({
      ok: true,
      items: [],
    });

    tables.challenge_items = [
      {
        id: ITEM,
        restaurant_id: RESTAURANT,
        status: 'assigned',
        offer_version_id: VERSION,
        redemption_deadline: '2020-01-01T00:00:00.000Z',
        cycle_id: CYCLE,
      },
    ];
    await expect(findPartnerArrivalItems({ email: 'ada@example.com' })).resolves.toEqual({
      ok: true,
      items: [],
    });

    const confirmed = await confirmPartnerBillSubtotal({
      sessionId: SESSION,
      eligibleSubtotalCents: 8200,
      proposalId: PROPOSAL,
    });
    expect(confirmed).toMatchObject({ ok: true });
    expect(updates).toEqual([
      { table: 'bill_scan_proposals', patch: { confirmed_eligible_subtotal_cents: 8200 } },
    ]);
    expect(supersede).toHaveBeenCalledWith({ sessionId: SESSION, eligibleSubtotalCents: 8200 });
    expect(readAzure).not.toHaveBeenCalled();
    expect(storeBillScanProposal).not.toHaveBeenCalled();
  });

  it('does not supersede when the proposal is not this restaurant session', async () => {
    process.env.E07_ARRIVAL_SESSIONS_ENABLED = 'true';
    tables.bill_scan_proposals = [];
    await expect(
      confirmPartnerBillSubtotal({
        sessionId: SESSION,
        eligibleSubtotalCents: 8200,
        proposalId: PROPOSAL,
      }),
    ).resolves.toEqual({ ok: false, code: 'not_found' });
    expect(supersede).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('keeps the arrival screen behind the flag and off member routes', () => {
    const page = readFileSync(path.join(ROOT, 'src/app/partner/[slug]/arrival/page.tsx'), 'utf8');
    const client = readFileSync(path.join(ROOT, 'src/components/partner/partner-arrival-client.tsx'), 'utf8');
    const action = readFileSync(path.join(ROOT, 'src/app/actions/partner-bill-scan.ts'), 'utf8');
    expect(page).toMatch(/if \(!arrivalSessionsEnabled\(\)\) notFound\(\)/);
    expect(page).not.toMatch(/boost_arrival_sessions|storeBillScanProposal|readAzurePrebuiltReceipt|quoteBoost/);
    expect(client).toMatch(/createBoostArrivalSession/);
    expect(client).toMatch(/eligibleSubtotalCents: 0/);
    expect(client).not.toMatch(/readAzurePrebuiltReceipt|storeBillScanProposal|quoteBoost|MINIMUM_CREDIT_BASE_CENTS/);
    expect(action).toMatch(/arrivalSessionsEnabled/);
    expect(action).toMatch(/azureBillScanEnabled/);
    expect(action).not.toMatch(/\bquoteBoost\s*\(|verify_redemption|verifyRedemptionTokenForPartner|MINIMUM_CREDIT_BASE_CENTS/);
    expect(action).not.toMatch(/E07_ARRIVAL_SESSIONS_ENABLED\s*=\s*'true'/);
    expect(action).not.toMatch(/E07_BILL_SCAN_AZURE_ENABLED\s*=\s*'true'/);
  });
});
