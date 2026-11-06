import {
  BILL_PROPOSAL_LOW_CONFIDENCE_BELOW,
  type BillProposalInput,
  type BillProposalLineInput,
} from '@/lib/boost/bill-proposal';
import {
  RECEIPT_MAX_BYTES,
  isReceiptContentType,
} from '@/lib/boost/receipt-limits';
import type { ExclusionPolicy } from '@/lib/offers/calculator';

/** Exact string only. Unset, empty, and every other value stay off. */
export const AZURE_RECEIPT_FLAG = 'E07_BILL_SCAN_AZURE_ENABLED';

export const AZURE_RECEIPT_ENDPOINT_ENV = 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT';
export const AZURE_RECEIPT_KEY_ENV = 'AZURE_DOCUMENT_INTELLIGENCE_KEY';

export const AZURE_RECEIPT_MODEL_ID = 'prebuilt-receipt';
export const AZURE_RECEIPT_API_VERSION = '2024-11-30';
export const AZURE_RECEIPT_SOURCE = 'azure_prebuilt_receipt' as const;

export const AZURE_RECEIPT_REFUSALS = ['disabled', 'missing_config', 'unreadable_receipt'] as const;

export type AzureReceiptRefusal = (typeof AZURE_RECEIPT_REFUSALS)[number];

export type AzureReceiptEnv = {
  E07_BILL_SCAN_AZURE_ENABLED?: string;
  AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?: string;
  AZURE_DOCUMENT_INTELLIGENCE_KEY?: string;
};

export function azureBillScanEnabled(value: string | undefined): boolean {
  return value === 'true';
}

const MAX_ANALYZE_BODY_BYTES = 2_000_000;
const MAX_POLLS = 4;

export type AzureReceiptReadInput = {
  objectPath: string;
  contentType: string;
  /** Fixture or server-loaded object bytes. Never a browser path. */
  bytes?: Uint8Array;
  policy: ExclusionPolicy;
  env?: AzureReceiptEnv;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type AzureReceiptReadResult =
  | { ok: true; input: BillProposalInput }
  | { ok: false; code: AzureReceiptRefusal };

/**
 * Propose-only reader for Azure Document Intelligence `prebuilt-receipt`.
 * Live HTTP runs only when `E07_BILL_SCAN_AZURE_ENABLED` is exactly `true`
 * and the endpoint and key are set. This does not call `quoteBoost`.
 */
export async function readAzurePrebuiltReceipt(
  input: AzureReceiptReadInput,
): Promise<AzureReceiptReadResult> {
  const env = input.env ?? process.env;
  if (!azureBillScanEnabled(env.E07_BILL_SCAN_AZURE_ENABLED)) {
    return { ok: false, code: 'disabled' };
  }
  const endpoint = env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.trim() ?? '';
  const apiKey = env.AZURE_DOCUMENT_INTELLIGENCE_KEY?.trim() ?? '';
  const origin = azureEndpointOrigin(endpoint);
  if (!origin || apiKey.length === 0) return { ok: false, code: 'missing_config' };
  if (!liveBytesReady(input)) return { ok: false, code: 'unreadable_receipt' };

  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? defaultSleep;
  const analyzeUrl = `${origin.origin}/documentintelligence/documentModels/${AZURE_RECEIPT_MODEL_ID}:analyze?api-version=${AZURE_RECEIPT_API_VERSION}`;
  let response: Response;
  try {
    response = await fetchImpl(analyzeUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': input.contentType,
      },
      body: bytesToBlob(input.bytes, input.contentType),
    });
  } catch {
    return { ok: false, code: 'unreadable_receipt' };
  }
  if (response.status === 200) {
    const payload = await readJson(response);
    if (!payload) return { ok: false, code: 'unreadable_receipt' };
    return mapAzurePrebuiltReceipt(payload, input.policy);
  }
  if (response.status !== 202) return { ok: false, code: 'unreadable_receipt' };
  const operation = response.headers.get('operation-location');
  if (!operation || !safeOperationUrl(operation, origin, apiKey)) {
    return { ok: false, code: 'unreadable_receipt' };
  }
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    if (attempt > 0) await sleep(250);
    let poll: Response;
    try {
      poll = await fetchImpl(operation, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      });
    } catch {
      return { ok: false, code: 'unreadable_receipt' };
    }
    if (poll.status !== 200) return { ok: false, code: 'unreadable_receipt' };
    const payload = await readJson(poll);
    if (!payload || !isRecord(payload)) return { ok: false, code: 'unreadable_receipt' };
    if (payload.status === 'succeeded') return mapAzurePrebuiltReceipt(payload, input.policy);
    if (payload.status === 'running' || payload.status === 'notStarted') continue;
    return { ok: false, code: 'unreadable_receipt' };
  }
  return { ok: false, code: 'unreadable_receipt' };
}

/**
 * Map a recorded analyze-result JSON into `proposeBillEligibleSubtotal` input.
 * Gross is `Total` in integer cents. `Subtotal` is not copied and is not added
 * to tax or tip. No tier, Boost, or discount field is returned.
 */
export function mapAzurePrebuiltReceipt(
  payload: unknown,
  policy: ExclusionPolicy,
): AzureReceiptReadResult {
  const document = firstDocument(payload);
  if (!document) return { ok: false, code: 'unreadable_receipt' };
  const fields = document.fields;
  const total = readMoney(fields.Total);
  const tax = readTax(fields);
  const tip = readMoney(fields.Tip);
  const lines = readItems(fields.Items);
  let cardStripped = lines.stripped;
  const identity = checkIdentity(fields);
  if (identity.stripped) cardStripped = true;
  const confidence = foldConfidence(readConfidence(document.confidence), [
    total.confidence,
    tax.confidence,
    tip.confidence,
  ]);
  const meta: BillProposalInput['meta'] = {
    source: AZURE_RECEIPT_SOURCE,
    confidence,
  };
  if (cardStripped) meta.cardDataStripped = true;
  if (lines.ambiguous) meta.ambiguousLineItems = true;
  if (lines.lines.length > 0) meta.lineItems = lines.lines;
  if (identity.text) meta.checkIdentity = identity.text;
  return {
    ok: true,
    input: {
      bill: {
        grossCents: total.present ? total.cents : null,
        taxCents: tax.present ? tax.cents : null,
        tipCents: tip.present ? tip.cents : null,
        categoryCents: [],
      },
      policy: {
        excludeTax: policy.excludeTax,
        excludeTip: policy.excludeTip,
        categories: [...policy.categories],
      },
      meta,
    },
  };
}

function bytesToBlob(bytes: Uint8Array, contentType: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: contentType });
}

function liveBytesReady(input: AzureReceiptReadInput): input is AzureReceiptReadInput & { bytes: Uint8Array } {
  if (!input.bytes || input.bytes.byteLength === 0 || input.bytes.byteLength > RECEIPT_MAX_BYTES) return false;
  if (!isReceiptContentType(input.contentType)) return false;
  if (!input.objectPath || input.objectPath.includes('..') || input.objectPath.includes('\\')) return false;
  if (input.objectPath.includes('://')) return false;
  return true;
}

function azureEndpointOrigin(endpoint: string): URL | null {
  if (!endpoint) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url;
}

function safeOperationUrl(value: string, endpoint: URL, apiKey: string): boolean {
  if (value.includes(apiKey)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.origin !== endpoint.origin || url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return url.pathname.startsWith('/documentintelligence/');
}

async function readJson(response: Response): Promise<unknown | null> {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > MAX_ANALYZE_BODY_BYTES) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ANALYZE_BODY_BYTES) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstDocument(payload: unknown): { confidence: unknown; fields: Record<string, unknown> } | null {
  if (!isRecord(payload)) return null;
  if ('status' in payload && payload.status !== 'succeeded') return null;
  const inner = isRecord(payload.analyzeResult) ? payload.analyzeResult : payload;
  if (inner !== payload && 'status' in inner && inner.status !== 'succeeded') return null;
  const modelId = inner.modelId ?? payload.modelId;
  if (modelId !== undefined && modelId !== AZURE_RECEIPT_MODEL_ID) return null;
  if (!Array.isArray(inner.documents) || inner.documents.length === 0) return null;
  const document = inner.documents[0];
  if (!isRecord(document) || !isRecord(document.fields)) return null;
  return { confidence: document.confidence, fields: document.fields };
}

type MoneyRead = {
  present: boolean;
  cents: number | null;
  confidence: number | null | undefined;
};

function readConfidence(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) return value;
  return null;
}

function readMoney(field: unknown): MoneyRead {
  if (field === undefined) return { present: false, cents: null, confidence: undefined };
  if (!isRecord(field)) return { present: true, cents: null, confidence: null };
  const confidence = readConfidence(field.confidence);
  const currency = field.valueCurrency;
  if (!isRecord(currency) || typeof currency.amount !== 'number' || !Number.isFinite(currency.amount)) {
    return { present: true, cents: null, confidence };
  }
  const scaled = currency.amount * 100;
  const cents = Math.round(scaled);
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > 1e-4) {
    return { present: true, cents: null, confidence };
  }
  return { present: true, cents, confidence };
}

function readTax(fields: Record<string, unknown>): MoneyRead {
  if ('TotalTax' in fields) return readMoney(fields.TotalTax);
  if ('Tax' in fields) return readMoney(fields.Tax);
  if (!('TaxDetails' in fields)) return { present: false, cents: null, confidence: undefined };
  const details = fields.TaxDetails;
  if (!isRecord(details) || !Array.isArray(details.valueArray)) {
    return { present: true, cents: null, confidence: null };
  }
  let sum = 0;
  let confidence: number | null | undefined = undefined;
  for (const entry of details.valueArray) {
    if (!isRecord(entry) || !isRecord(entry.valueObject)) {
      return { present: true, cents: null, confidence: null };
    }
    const amount = readMoney(entry.valueObject.Amount);
    if (!amount.present || amount.cents === null) {
      return { present: true, cents: null, confidence: amount.confidence ?? null };
    }
    sum += amount.cents;
    confidence = minKnownConfidence(confidence, amount.confidence);
  }
  if (!Number.isSafeInteger(sum)) return { present: true, cents: null, confidence };
  return { present: true, cents: sum, confidence };
}

function minKnownConfidence(
  current: number | null | undefined,
  value: number | null | undefined,
): number | null | undefined {
  if (current === null || value === null) return null;
  if (value === undefined) return current;
  if (current === undefined) return value;
  return Math.min(current, value);
}

function foldConfidence(
  documentConfidence: number | null | undefined,
  fields: Array<number | null | undefined>,
): number | null | undefined {
  if (documentConfidence === null) return null;
  let lowest: number | undefined = documentConfidence;
  for (const value of fields) {
    if (value === undefined) continue;
    if (value === null) return null;
    lowest = lowest === undefined ? value : Math.min(lowest, value);
  }
  if (
    documentConfidence === undefined &&
    (lowest === undefined || lowest >= BILL_PROPOSAL_LOW_CONFIDENCE_BELOW)
  ) {
    return undefined;
  }
  return lowest;
}

/** Same 13–19 digit run as `proposeBillEligibleSubtotal`. Longer runs stay. */
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

function readItems(field: unknown): {
  lines: BillProposalLineInput[];
  ambiguous: boolean;
  stripped: boolean;
} {
  if (field === undefined) return { lines: [], ambiguous: false, stripped: false };
  if (!isRecord(field) || !Array.isArray(field.valueArray)) {
    return { lines: [], ambiguous: true, stripped: false };
  }
  const lines: BillProposalLineInput[] = [];
  let ambiguous = false;
  let stripped = false;
  for (const entry of field.valueArray) {
    if (!isRecord(entry) || !isRecord(entry.valueObject)) {
      ambiguous = true;
      continue;
    }
    const object = entry.valueObject;
    const label = fieldText(object.Description);
    if (!label) {
      ambiguous = true;
      continue;
    }
    const redacted = redactCardRuns(label);
    if (redacted.stripped) stripped = true;
    const price = readMoney(object.TotalPrice);
    const line: BillProposalLineInput = { label: redacted.text, cents: price.present ? price.cents : null };
    const category = fieldText(object.Category) ?? fieldText(object.category);
    if (category) line.category = category;
    const itemConfidence = readConfidence(entry.confidence);
    line.confidence = itemConfidence === undefined ? price.confidence : itemConfidence;
    if (line.confidence === undefined) delete line.confidence;
    lines.push(line);
  }
  return { lines, ambiguous, stripped };
}

function fieldText(field: unknown): string | null {
  if (!isRecord(field)) return null;
  if (typeof field.valueString === 'string' && field.valueString.trim()) return field.valueString.trim();
  if (typeof field.content === 'string' && field.content.trim()) return field.content.trim();
  return null;
}

function checkIdentity(fields: Record<string, unknown>): { text: string | null; stripped: boolean } {
  const name = fieldText(fields.MerchantName);
  const address = addressText(fields.MerchantAddress);
  const date = fieldText(fields.TransactionDate) ?? valueText(fields.TransactionDate, 'valueDate');
  const time = fieldText(fields.TransactionTime) ?? valueText(fields.TransactionTime, 'valueTime');
  const when = [date, time].filter((part): part is string => Boolean(part)).join(' ');
  const parts = [name, address, when].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return { text: null, stripped: false };
  return redactCardRuns(parts.join(' | '));
}

function valueText(field: unknown, key: 'valueDate' | 'valueTime'): string | null {
  if (!isRecord(field) || typeof field[key] !== 'string') return null;
  const text = field[key].trim();
  return text.length > 0 ? text : null;
}

function addressText(field: unknown): string | null {
  const content = fieldText(field);
  if (content) return content;
  if (!isRecord(field) || !isRecord(field.valueAddress)) return null;
  const address = field.valueAddress;
  const parts = ['streetAddress', 'houseNumber', 'road', 'city', 'state', 'postalCode', 'countryRegion']
    .map((key) => address[key])
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());
  return parts.length > 0 ? parts.join(' ') : null;
}
