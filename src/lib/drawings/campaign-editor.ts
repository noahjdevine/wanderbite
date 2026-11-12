/**
 * Pure form checks for the admin sample-campaign editor.
 * Dollars become integer cents before a store call. Sample mode, the
 * rules-version token, and the level-milestone entry source are fixed
 * here. starts_at and ends_at are not computed again: the store's
 * payloadFor reads them from campaignWindow(quarterKey).
 *
 * No database, network, or environment access. This does not set
 * official rules text or real prize amounts.
 */

import {
  CAMPAIGN_ERROR_CODES,
  LEVEL_MILESTONE_ENTRY_SOURCE,
  SAMPLE_PRIZE_MARKER,
  campaignWindow,
  displayPrizeLabel,
  type CampaignDraft,
  type CampaignErrorCode,
} from '@/lib/drawings/campaign';
import { parseFulfillmentDollars } from '@/lib/drawings/fulfillment-admin-actions';
import { chicagoQuarterKey } from '@/lib/progression/quarter';

/** Token stored on sample drafts from this editor. Not official rules text. */
export const SAMPLE_CAMPAIGN_RULES_VERSION = 'v0';

export const CAMPAIGN_EDITOR_MAX_PRIZES = 10;

export const CAMPAIGN_EDITOR_MAX_QUANTITY = 1000;

/** Inclusive dollar cap. $100,000.00 is valid. One cent more is not. */
export const CAMPAIGN_EDITOR_MAX_DOLLARS = 100_000;

const QUARTER_KEY = /^(\d{4})-Q([1-4])$/;

const CHICAGO_CALENDAR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const DOLLAR_GROUPS = new Intl.NumberFormat('en-US');

export const CAMPAIGN_AMOUNT_MESSAGE =
  'Enter a dollar amount from $0.00 to $100,000.00 with at most two decimal places.';

export const CAMPAIGN_QUANTITY_MESSAGE = 'Enter a whole number from 1 to 1,000.';

export type CampaignEditorPrizeInput = {
  label?: string;
  quantity?: string;
  unitValueDollars?: string;
};

export type CampaignEditorInput = {
  quarterKey?: string;
  totalBudgetDollars?: string;
  fulfillmentAllowanceDollars?: string;
  prizes?: CampaignEditorPrizeInput[];
};

export type CampaignEditorSeed = {
  quarterKey: string;
  totalBudgetDollars: string;
  fulfillmentAllowanceDollars: string;
  prizes: { label: string; quantity: string; unitValueDollars: string }[];
};

export type CampaignEditorFieldError = {
  field: string;
  message: string;
};

export type CampaignEditorParseResult =
  | { ok: true; draft: CampaignDraft }
  | { ok: false; fieldErrors: CampaignEditorFieldError[] };

export type ParsedCampaignDollars = { ok: true; cents: number } | { ok: false };

export type CommittedPreview = {
  committedCents: number | null;
  totalBudgetCents: number | null;
  over: boolean;
  label: string;
};

/**
 * Current America/Chicago quarter, then the next three.
 * On 2026-11-12 that is 2026-Q4, 2027-Q1, 2027-Q2, 2027-Q3.
 * The process time zone is not consulted.
 */
export function quarterOptions(now: Date | string): string[] {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) return [];
  let key: string;
  try {
    key = chicagoQuarterKey(instant.toISOString());
  } catch {
    return [];
  }
  const options = [key];
  for (let step = 0; step < 3; step += 1) {
    key = nextQuarterKey(key);
    options.push(key);
  }
  return options;
}

/**
 * Inclusive Chicago dates for the quarter. The end shown is one
 * millisecond before campaignWindow's exclusive end, so 2027-Q1 reads
 * Jan 1, 2027 – Mar 31, 2027. A bad key returns null.
 */
export function campaignWindowLabel(quarterKey: string): string | null {
  const window = campaignWindow(quarterKey);
  if (!window) return null;
  const start = CHICAGO_CALENDAR.format(new Date(window.startsAt));
  const end = CHICAGO_CALENDAR.format(new Date(Date.parse(window.endsAt) - 1));
  return `${start} – ${end}`;
}

/**
 * Same dollar text as the admin list. Whole cents, two decimal places.
 */
export function formatCampaignDollars(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const body = `$${DOLLAR_GROUPS.format(dollars)}.${String(remainder).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/** Dollar text for an input. No thousands separator, so the parser can read it back. */
export function centsToDollarInput(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const body = `${dollars}.${String(remainder).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

export function campaignEditorSeed(campaign: {
  quarterKey: string;
  totalBudgetCents: number;
  allowanceCents: number;
  prizes: readonly { label: string; quantity: number; unitValueCents: number }[];
}): CampaignEditorSeed {
  return {
    quarterKey: campaign.quarterKey,
    totalBudgetDollars: centsToDollarInput(campaign.totalBudgetCents),
    fulfillmentAllowanceDollars: centsToDollarInput(campaign.allowanceCents),
    prizes: campaign.prizes.map((prize) => ({
      label: prize.label,
      quantity: String(prize.quantity),
      unitValueDollars: centsToDollarInput(prize.unitValueCents),
    })),
  };
}

/**
 * B9 dollar parser, then the $100,000 cap. Empty, negative, non-numeric,
 * more than two decimal places, and anything above the cap are invalid.
 * Zero is valid. "12.5" is $12.50.
 */
export function parseCampaignDollars(input: string | null | undefined): ParsedCampaignDollars {
  if (typeof input !== 'string') return { ok: false };
  const parsed = parseFulfillmentDollars(input);
  if (!parsed.ok) return { ok: false };
  if (parsed.cents > CAMPAIGN_EDITOR_MAX_DOLLARS * 100) return { ok: false };
  return { ok: true, cents: parsed.cents };
}

/**
 * Live committed line. Equal to the total is not over. A field that
 * does not parse leaves that side null and does not mark the line over.
 */
export function committedPreview(input: CampaignEditorInput): CommittedPreview {
  const total = parseCampaignDollars(input.totalBudgetDollars);
  const allowance = parseCampaignDollars(input.fulfillmentAllowanceDollars);
  const totalBudgetCents = total.ok ? total.cents : null;
  let committedCents: number | null = allowance.ok ? allowance.cents : null;
  const prizes = Array.isArray(input.prizes) ? input.prizes : [];
  if (committedCents !== null) {
    for (const prize of prizes) {
      const quantity = parseQuantity(prize?.quantity);
      const unit = parseCampaignDollars(prize?.unitValueDollars);
      if (!quantity.ok || !unit.ok) {
        committedCents = null;
        break;
      }
      const product = quantity.quantity * unit.cents;
      if (!Number.isSafeInteger(product)) {
        committedCents = null;
        break;
      }
      committedCents += product;
      if (!Number.isSafeInteger(committedCents)) {
        committedCents = null;
        break;
      }
    }
  }
  const over =
    committedCents !== null && totalBudgetCents !== null && committedCents > totalBudgetCents;
  const committedText = committedCents === null ? '—' : formatCampaignDollars(committedCents);
  const totalText = totalBudgetCents === null ? '—' : formatCampaignDollars(totalBudgetCents);
  return {
    committedCents,
    totalBudgetCents,
    over,
    label: `Committed ${committedText} of ${totalText} budget`,
  };
}

/**
 * Form input to a sample CampaignDraft. Field problems return before any
 * store call. A draft that is over budget still parses; the store rejects
 * that. Prize order is the list order. The saved label is the sample
 * preview from displayPrizeLabel.
 */
export function parseCampaignEditorForm(input: unknown): CampaignEditorParseResult {
  const row = asRecord(input);
  const fieldErrors: CampaignEditorFieldError[] = [];
  const quarterKey = typeof row?.quarterKey === 'string' ? row.quarterKey.trim() : '';
  if (!QUARTER_KEY.test(quarterKey)) {
    fieldErrors.push({ field: 'quarterKey', message: 'Choose a quarter.' });
  }

  const total = parseCampaignDollars(typeof row?.totalBudgetDollars === 'string' ? row.totalBudgetDollars : undefined);
  if (!total.ok) {
    fieldErrors.push({ field: 'totalBudgetDollars', message: CAMPAIGN_AMOUNT_MESSAGE });
  }
  const allowance = parseCampaignDollars(
    typeof row?.fulfillmentAllowanceDollars === 'string' ? row.fulfillmentAllowanceDollars : undefined,
  );
  if (!allowance.ok) {
    fieldErrors.push({ field: 'fulfillmentAllowanceDollars', message: CAMPAIGN_AMOUNT_MESSAGE });
  }

  const prizeInput = row?.prizes;
  if (!Array.isArray(prizeInput) || prizeInput.length === 0) {
    fieldErrors.push({ field: 'prizes', message: 'Add at least one sample prize.' });
    return { ok: false, fieldErrors };
  }
  if (prizeInput.length > CAMPAIGN_EDITOR_MAX_PRIZES) {
    fieldErrors.push({
      field: 'prizes',
      message: `A sample campaign can have at most ${CAMPAIGN_EDITOR_MAX_PRIZES} prizes.`,
    });
    return { ok: false, fieldErrors };
  }

  const prizes: CampaignDraft['prizes'] = [];
  prizeInput.forEach((prize, index) => {
    const prizeRow = asRecord(prize);
    const labelText = typeof prizeRow?.label === 'string' ? prizeRow.label.trim() : '';
    if (labelText === '') {
      fieldErrors.push({ field: `prizes.${index}.label`, message: 'Enter a prize label.' });
    }
    const quantity = parseQuantity(typeof prizeRow?.quantity === 'string' ? prizeRow.quantity : undefined);
    if (!quantity.ok) {
      fieldErrors.push({ field: `prizes.${index}.quantity`, message: CAMPAIGN_QUANTITY_MESSAGE });
    }
    const unit = parseCampaignDollars(
      typeof prizeRow?.unitValueDollars === 'string' ? prizeRow.unitValueDollars : undefined,
    );
    if (!unit.ok) {
      fieldErrors.push({ field: `prizes.${index}.unitValueDollars`, message: CAMPAIGN_AMOUNT_MESSAGE });
    }
    if (labelText !== '' && quantity.ok && unit.ok) {
      prizes.push({
        label: displayPrizeLabel({ label: labelText }, 'sample'),
        quantity: quantity.quantity,
        unitValueCents: unit.cents,
        isSample: true,
      });
    }
  });

  if (fieldErrors.length > 0 || !total.ok || !allowance.ok) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    draft: {
      quarterKey,
      mode: 'sample',
      rulesVersion: SAMPLE_CAMPAIGN_RULES_VERSION,
      totalBudgetCents: total.cents,
      fulfillmentAllowanceCents: allowance.cents,
      prizes,
      eligibleEntrySources: [LEVEL_MILESTONE_ENTRY_SOURCE],
    },
  };
}

/** The label the form previews and the editor saves. */
export function samplePrizePreview(label: string): string {
  return displayPrizeLabel({ label }, 'sample');
}

export const CAMPAIGN_EDITOR_STORE_ERRORS = [
  'not_found',
  'unavailable',
  'quarter_campaign_open',
  'campaign_locked',
  'invalid_transition',
  'live_activation_blocked',
  'campaign_window_ended',
  'no_prizes',
  'over_budget',
] as const;

export type CampaignEditorStoreError = (typeof CAMPAIGN_EDITOR_STORE_ERRORS)[number];

const STORE_ERROR_SET: ReadonlySet<string> = new Set(CAMPAIGN_EDITOR_STORE_ERRORS);

export function isCampaignEditorStoreError(code: string): code is CampaignEditorStoreError {
  return STORE_ERROR_SET.has(code);
}

export const CAMPAIGN_EDITOR_GUARD_ERRORS = [
  'disabled',
  'forbidden',
  'mfa_enroll',
  'mfa_challenge',
  'auth_error',
  'role_lookup_failed',
  'invalid_form',
] as const;

export type CampaignEditorGuardError = (typeof CAMPAIGN_EDITOR_GUARD_ERRORS)[number];

export const CAMPAIGN_EDITOR_ERRORS = [
  ...CAMPAIGN_EDITOR_GUARD_ERRORS,
  ...CAMPAIGN_ERROR_CODES,
  ...CAMPAIGN_EDITOR_STORE_ERRORS,
] as const;

export type CampaignEditorError = (typeof CAMPAIGN_EDITOR_ERRORS)[number];

const MESSAGES: Record<CampaignEditorError, string> = {
  disabled: 'Drawing campaign editing is turned off.',
  forbidden: "You don't have access to drawing actions.",
  mfa_enroll: 'Authenticator setup is required before this action.',
  mfa_challenge: 'Authenticator verification is required before this action.',
  auth_error: 'Authenticator assurance could not be checked.',
  role_lookup_failed: 'Admin permissions could not be checked.',
  invalid_form: 'Check the campaign fields and try again.',
  invalid_quarter_key: 'Choose a quarter.',
  invalid_mode: 'This page saves sample campaigns only.',
  invalid_rules_version: 'This sample campaign could not be saved.',
  non_integer_cents: 'Enter dollar amounts with at most two decimal places.',
  negative_cents: 'Enter a dollar amount that is not negative.',
  empty_prizes: 'Add at least one sample prize.',
  invalid_label: 'Enter a prize label.',
  non_integer_quantity: 'Enter a whole number of prizes.',
  negative_quantity: 'Enter a prize quantity that is not negative.',
  zero_quantity: 'Enter a prize quantity of at least 1.',
  sample_prize_required: 'Each prize has to be a sample prize.',
  sample_label_required: `Each prize label has to include ${SAMPLE_PRIZE_MARKER}.`,
  live_sample_prize: 'This page saves sample campaigns only.',
  unknown_entry_source: 'Drawing entries for this campaign come from level milestones.',
  public_review_entry: 'Public reviews are not a drawing entry source.',
  over_budget: 'The prizes and fulfillment allowance are over the campaign budget.',
  not_found: 'That drawing campaign was not found.',
  unavailable: 'Drawing records are unavailable.',
  quarter_campaign_open: 'A campaign for that quarter is already open.',
  campaign_locked: "This campaign is no longer a draft, so it can't be edited.",
  invalid_transition: "That status change isn't allowed.",
  live_activation_blocked: "Live campaigns can't go active until official rules exist.",
  campaign_window_ended: "This campaign's window has ended.",
  no_prizes: 'Add at least one sample prize.',
};

export function campaignEditorMessage(code: CampaignEditorError): string {
  return MESSAGES[code];
}

export function isCampaignErrorCode(code: string): code is CampaignErrorCode {
  return (CAMPAIGN_ERROR_CODES as readonly string[]).includes(code);
}

function parseQuantity(input: string | null | undefined): { ok: true; quantity: number } | { ok: false } {
  if (typeof input !== 'string') return { ok: false };
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  const quantity = Number(trimmed);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > CAMPAIGN_EDITOR_MAX_QUANTITY) {
    return { ok: false };
  }
  return { ok: true, quantity };
}

function nextQuarterKey(key: string): string {
  const match = QUARTER_KEY.exec(key);
  if (!match) return key;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  if (quarter === 4) return `${year + 1}-Q1`;
  return `${year}-Q${quarter + 1}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
