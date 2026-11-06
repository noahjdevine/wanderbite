import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AZURE_RECEIPT_API_VERSION,
  AZURE_RECEIPT_MODEL_ID,
  mapAzurePrebuiltReceipt,
  readAzurePrebuiltReceipt,
} from '@/lib/boost/azure-receipt';
import { mergeStaffBillOverride, proposeBillEligibleSubtotal } from '@/lib/boost/bill-proposal';
import { azureEightyTwoReceipt } from '@/lib/boost/fixtures/azure-receipt';
import { taxAndTipPolicy } from '@/lib/boost/fixtures/bill-scan';

const ROOT = path.resolve(__dirname, '../../..');
const ENDPOINT = 'https://unit.cognitiveservices.azure.com';
const KEY = 'unit-test-key';
const QUOTE_FIELDS = ['tier_id', 'boost_id', 'total_discount_cents', 'base_discount_cents', 'boost_discount_cents'];

function assertNoQuoteFields(value: unknown) {
  const json = JSON.stringify(value);
  for (const field of QUOTE_FIELDS) expect(json).not.toContain(`"${field}"`);
}

function fieldsOf(payload: Record<string, unknown>): Record<string, unknown> {
  const analyze = payload.analyzeResult as { documents: Array<{ fields: Record<string, unknown>; confidence?: number }> };
  return analyze.documents[0].fields;
}

describe('azure prebuilt receipt adapter', () => {
  it('maps the fixture through the existing exclusion helper and returns no discount', () => {
    const mapped = mapAzurePrebuiltReceipt(azureEightyTwoReceipt(), taxAndTipPolicy);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.input.bill).toEqual({
      grossCents: 10000,
      taxCents: 800,
      tipCents: 1000,
      categoryCents: [],
    });
    expect(mapped.input.meta?.source).toBe('azure_prebuilt_receipt');
    expect(mapped.input.meta?.lineItems?.[0]).toMatchObject({ label: 'Food', cents: 8200 });
    expect(mapped.input.meta?.checkIdentity).toContain('Fixture Grill');
    expect(mapped.input.meta?.checkIdentity).toContain('1 Fixture St');
    expect(JSON.stringify(mapped.input)).not.toContain('987-654-3210');
    const proposal = proposeBillEligibleSubtotal(mapped.input);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.proposed_eligible_subtotal_cents).toBe(8200);
    expect(proposal.uncertainty_flags).toEqual([]);
    assertNoQuoteFields(mapped);
    assertNoQuoteFields(proposal);
    const confirmed = mergeStaffBillOverride(proposal, 8100);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.confirmed_eligible_subtotal_cents).toBe(8100);
    expect(confirmed.proposal.proposed_eligible_subtotal_cents).toBe(8200);
    assertNoQuoteFields(confirmed);
  });

  it('does not invent gross from subtotal, tax, and tip', () => {
    const payload = azureEightyTwoReceipt();
    delete fieldsOf(payload).Total;
    const mapped = mapAzurePrebuiltReceipt(payload, taxAndTipPolicy);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.input.bill.grossCents).toBeNull();
    const proposal = proposeBillEligibleSubtotal(mapped.input);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.proposed_eligible_subtotal_cents).toBeNull();
    expect(proposal.uncertainty_flags).toContain('missing_subtotal');
  });

  it('uses TotalPrice and not quantity times unit price', () => {
    const payload = azureEightyTwoReceipt();
    const item = (
      fieldsOf(payload).Items as { valueArray: Array<{ valueObject: Record<string, unknown> }> }
    ).valueArray[0].valueObject;
    item.Price = { type: 'currency', valueCurrency: { amount: 10 }, confidence: 0.9 };
    item.Quantity = { type: 'number', valueNumber: 3, confidence: 0.9 };
    const mapped = mapAzurePrebuiltReceipt(payload, taxAndTipPolicy);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.input.meta?.lineItems?.[0].cents).toBe(8200);
  });

  it('sums TaxDetails when TotalTax is absent and prefers TotalTax when both exist', () => {
    const detailsOnly = azureEightyTwoReceipt();
    const fields = fieldsOf(detailsOnly);
    delete fields.TotalTax;
    fields.TaxDetails = {
      type: 'array',
      valueArray: [
        { valueObject: { Amount: { type: 'currency', valueCurrency: { amount: 5 }, confidence: 0.9 } } },
        { valueObject: { Amount: { type: 'currency', valueCurrency: { amount: 3 }, confidence: 0.91 } } },
      ],
    };
    const summed = mapAzurePrebuiltReceipt(detailsOnly, taxAndTipPolicy);
    expect(summed.ok).toBe(true);
    if (!summed.ok) return;
    expect(summed.input.bill.taxCents).toBe(800);

    const both = azureEightyTwoReceipt();
    fieldsOf(both).TaxDetails = {
      type: 'array',
      valueArray: [
        { valueObject: { Amount: { type: 'currency', valueCurrency: { amount: 1 }, confidence: 0.99 } } },
      ],
    };
    const preferred = mapAzurePrebuiltReceipt(both, taxAndTipPolicy);
    expect(preferred.ok).toBe(true);
    if (!preferred.ok) return;
    expect(preferred.input.bill.taxCents).toBe(800);
  });

  it('flags confidence below 0.8, null, or omitted and still returns complete cents', () => {
    const low = azureEightyTwoReceipt();
    const lowDoc = (low.analyzeResult as { documents: Array<{ confidence?: number | null }> }).documents[0];
    lowDoc.confidence = 0.5;
    const lowMapped = mapAzurePrebuiltReceipt(low, taxAndTipPolicy);
    expect(lowMapped.ok).toBe(true);
    if (!lowMapped.ok) return;
    const lowProposal = proposeBillEligibleSubtotal(lowMapped.input);
    expect(lowProposal.ok).toBe(true);
    if (!lowProposal.ok) return;
    expect(lowProposal.proposed_eligible_subtotal_cents).toBe(8200);
    expect(lowProposal.uncertainty_flags).toEqual(['low_confidence']);

    const omitted = azureEightyTwoReceipt();
    delete (omitted.analyzeResult as { documents: Array<{ confidence?: number }> }).documents[0].confidence;
    const omittedMapped = mapAzurePrebuiltReceipt(omitted, taxAndTipPolicy);
    expect(omittedMapped.ok).toBe(true);
    if (!omittedMapped.ok) return;
    expect(omittedMapped.input.meta?.confidence).toBeUndefined();
    const omittedProposal = proposeBillEligibleSubtotal(omittedMapped.input);
    expect(omittedProposal.ok).toBe(true);
    if (!omittedProposal.ok) return;
    expect(omittedProposal.proposed_eligible_subtotal_cents).toBe(8200);
    expect(omittedProposal.uncertainty_flags).toContain('low_confidence');

    const missing = azureEightyTwoReceipt();
    (missing.analyzeResult as { documents: Array<{ confidence: number | null }> }).documents[0].confidence = null;
    const nullMapped = mapAzurePrebuiltReceipt(missing, taxAndTipPolicy);
    expect(nullMapped.ok).toBe(true);
    if (!nullMapped.ok) return;
    const nullProposal = proposeBillEligibleSubtotal(nullMapped.input);
    expect(nullProposal.ok).toBe(true);
    if (!nullProposal.ok) return;
    expect(nullProposal.uncertainty_flags).toContain('low_confidence');
    expect(nullProposal.proposed_eligible_subtotal_cents).toBe(8200);
  });

  it('redacts a card-like run and drops payment fields', () => {
    const payload = azureEightyTwoReceipt();
    const fields = fieldsOf(payload);
    const items = fields.Items as { valueArray: Array<{ valueObject: { Description: { valueString: string } } }> };
    items.valueArray[0].valueObject.Description.valueString = 'Card 4111111111111111 meal';
    fields.Payments = {
      type: 'array',
      valueArray: [
        {
          valueObject: {
            Method: { type: 'string', valueString: '4111111111111111' },
            Amount: { type: 'currency', valueCurrency: { amount: 100 } },
          },
        },
      ],
    };
    const mapped = mapAzurePrebuiltReceipt(payload, taxAndTipPolicy);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    const json = JSON.stringify(mapped.input);
    expect(json).not.toContain('4111111111111111');
    expect(json).toContain('[redacted]');
    expect(mapped.input.meta?.cardDataStripped).toBe(true);
    const proposal = proposeBillEligibleSubtotal(mapped.input);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.uncertainty_flags).toContain('possible_card_data_stripped');
    expect(JSON.stringify(proposal)).not.toContain('4111');
  });

  it('does not call Azure when the flag is unset or config is missing', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      throw new Error('fetch should not run');
    };
    const bytes = new Uint8Array([1, 2, 3]);
    const off = await readAzurePrebuiltReceipt({
      objectPath: 'member/id',
      contentType: 'image/jpeg',
      bytes,
      policy: taxAndTipPolicy,
      env: {
        AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: ENDPOINT,
        AZURE_DOCUMENT_INTELLIGENCE_KEY: KEY,
      },
      fetchImpl,
    });
    expect(off).toEqual({ ok: false, code: 'disabled' });
    const wrongFlag = await readAzurePrebuiltReceipt({
      objectPath: 'member/id',
      contentType: 'image/jpeg',
      bytes,
      policy: taxAndTipPolicy,
      env: { E07_BILL_SCAN_AZURE_ENABLED: 'TRUE', AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: ENDPOINT, AZURE_DOCUMENT_INTELLIGENCE_KEY: KEY },
      fetchImpl,
    });
    expect(wrongFlag).toEqual({ ok: false, code: 'disabled' });
    const missing = await readAzurePrebuiltReceipt({
      objectPath: 'member/id',
      contentType: 'image/jpeg',
      bytes,
      policy: taxAndTipPolicy,
      env: { E07_BILL_SCAN_AZURE_ENABLED: 'true', AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: ENDPOINT },
      fetchImpl,
    });
    expect(missing).toEqual({ ok: false, code: 'missing_config' });
    expect(calls).toEqual([]);
  });

  it('posts bytes to the prebuilt receipt model only when the flag is exactly true', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const payload = azureEightyTwoReceipt();
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return new Response('', {
          status: 202,
          headers: {
            'operation-location': `${ENDPOINT}/documentintelligence/documentModels/${AZURE_RECEIPT_MODEL_ID}/analyzeResults/unit?api-version=${AZURE_RECEIPT_API_VERSION}`,
          },
        });
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    };
    const result = await readAzurePrebuiltReceipt({
      objectPath: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      contentType: 'image/jpeg',
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      policy: taxAndTipPolicy,
      env: {
        E07_BILL_SCAN_AZURE_ENABLED: 'true',
        AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: ENDPOINT,
        AZURE_DOCUMENT_INTELLIGENCE_KEY: KEY,
      },
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.bill.grossCents).toBe(10000);
    expect(calls[0].url).toContain(`/documentModels/${AZURE_RECEIPT_MODEL_ID}:analyze`);
    expect(calls[0].url).toContain(`api-version=${AZURE_RECEIPT_API_VERSION}`);
    expect(calls[0].url).not.toContain(KEY);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('Ocp-Apim-Subscription-Key')).toBe(KEY);
    expect(calls[1].init?.body).toBeUndefined();
    assertNoQuoteFields(result);
  });

  it('does not follow an operation URL on another host', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      return new Response('', {
        status: 202,
        headers: { 'operation-location': 'https://evil.example/documentintelligence/steal' },
      });
    };
    const result = await readAzurePrebuiltReceipt({
      objectPath: 'member/id',
      contentType: 'image/jpeg',
      bytes: new Uint8Array([1]),
      policy: taxAndTipPolicy,
      env: {
        E07_BILL_SCAN_AZURE_ENABLED: 'true',
        AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: ENDPOINT,
        AZURE_DOCUMENT_INTELLIGENCE_KEY: KEY,
      },
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, code: 'unreadable_receipt' });
    expect(calls).toHaveLength(1);
  });

  it('stays out of the quote service and the app routes', () => {
    const source = readFileSync(path.join(ROOT, 'src/lib/boost/azure-receipt.ts'), 'utf8');
    expect(source).not.toMatch(/\bquoteBoost\s*\(|\bquoteOffer\s*\(/);
    expect(source).toContain(AZURE_RECEIPT_MODEL_ID);
  });
});
