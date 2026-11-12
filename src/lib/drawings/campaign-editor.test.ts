import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAMPAIGN_ERROR_CODES, SAMPLE_PRIZE_MARKER } from '@/lib/drawings/campaign';
import {
  CAMPAIGN_AMOUNT_MESSAGE,
  CAMPAIGN_EDITOR_MAX_PRIZES,
  CAMPAIGN_QUANTITY_MESSAGE,
  campaignEditorMessage,
  campaignEditorSeed,
  campaignWindowLabel,
  committedPreview,
  parseCampaignDollars,
  parseCampaignEditorForm,
  quarterOptions,
  type CampaignEditorInput,
} from '@/lib/drawings/campaign-editor';

const ROOT = path.resolve(__dirname, '../../..');

function form(overrides: Partial<CampaignEditorInput> = {}): CampaignEditorInput {
  return {
    quarterKey: '2027-Q1',
    totalBudgetDollars: '100',
    fulfillmentAllowanceDollars: '20',
    prizes: [{ label: 'Dinner for two', quantity: '2', unitValueDollars: '40' }],
    ...overrides,
  };
}

describe('parseCampaignDollars', () => {
  it('parses zero, one decimal, and the $100,000 cap', () => {
    expect(parseCampaignDollars('0')).toEqual({ ok: true, cents: 0 });
    expect(parseCampaignDollars('0.00')).toEqual({ ok: true, cents: 0 });
    expect(parseCampaignDollars('12.5')).toEqual({ ok: true, cents: 1_250 });
    expect(parseCampaignDollars(' 12.50 ')).toEqual({ ok: true, cents: 1_250 });
    expect(parseCampaignDollars('100000')).toEqual({ ok: true, cents: 10_000_000 });
    expect(parseCampaignDollars('100000.00')).toEqual({ ok: true, cents: 10_000_000 });
  });

  it('rejects negatives, non-numeric text, extra decimals, empty, and anything above the cap', () => {
    for (const input of ['12.345', '-1', 'abc', '', '100000.01', '100001', '+1', '1,000', '$12']) {
      expect(parseCampaignDollars(input), input).toEqual({ ok: false });
    }
    expect(parseCampaignDollars(undefined)).toEqual({ ok: false });
  });
});

describe('parseCampaignEditorForm', () => {
  it('builds a sample draft and saves the sample-prize preview', () => {
    const parsed = parseCampaignEditorForm(form());
    expect(parsed).toEqual({
      ok: true,
      draft: {
        quarterKey: '2027-Q1',
        mode: 'sample',
        rulesVersion: 'v0',
        totalBudgetCents: 10_000,
        fulfillmentAllowanceCents: 2_000,
        prizes: [
          {
            label: `${SAMPLE_PRIZE_MARKER}: Dinner for two`,
            quantity: 2,
            unitValueCents: 4_000,
            isSample: true,
          },
        ],
        eligibleEntrySources: ['level_milestone'],
      },
    });
    const already = parseCampaignEditorForm(form({ prizes: [{ label: 'Sample prize: Dinner for two', quantity: '2', unitValueDollars: '40' }] }));
    expect(already.ok).toBe(true);
    if (!already.ok) return;
    expect(already.draft.prizes[0]?.label).toBe('Sample prize: Dinner for two');
  });

  it('keeps prize order and still parses a draft that is over budget', () => {
    const parsed = parseCampaignEditorForm(
      form({
        fulfillmentAllowanceDollars: '30',
        prizes: [
          { label: 'Dinner for two', quantity: '2', unitValueDollars: '40' },
          { label: 'Lunch', quantity: '1', unitValueDollars: '0' },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.draft.prizes.map((prize) => prize.label)).toEqual([
      'Sample prize: Dinner for two',
      'Sample prize: Lunch',
    ]);
  });

  it('returns field errors for zero prizes, eleven prizes, a bad quantity, and a bad amount', () => {
    const none = parseCampaignEditorForm(form({ prizes: [] }));
    expect(none).toEqual({
      ok: false,
      fieldErrors: [{ field: 'prizes', message: 'Add at least one sample prize.' }],
    });
    const tooMany = parseCampaignEditorForm(
      form({
        prizes: Array.from({ length: CAMPAIGN_EDITOR_MAX_PRIZES + 1 }, () => ({
          label: 'Dinner',
          quantity: '1',
          unitValueDollars: '1',
        })),
      }),
    );
    expect(tooMany.ok).toBe(false);
    if (tooMany.ok) return;
    expect(tooMany.fieldErrors.map((error) => error.field)).toContain('prizes');
    expect(tooMany.fieldErrors.some((error) => error.message.includes(String(CAMPAIGN_EDITOR_MAX_PRIZES)))).toBe(true);

    const quantity = parseCampaignEditorForm(form({ prizes: [{ label: 'Dinner', quantity: '0', unitValueDollars: '40' }] }));
    expect(quantity.ok).toBe(false);
    if (quantity.ok) return;
    expect(quantity.fieldErrors).toContainEqual({ field: 'prizes.0.quantity', message: CAMPAIGN_QUANTITY_MESSAGE });

    for (const quantityText of ['1001', '-1', '1.5', 'abc', '']) {
      const result = parseCampaignEditorForm(
        form({ prizes: [{ label: 'Dinner', quantity: quantityText, unitValueDollars: '1' }] }),
      );
      expect(result.ok, quantityText).toBe(false);
    }

    const amount = parseCampaignEditorForm(form({ totalBudgetDollars: '12.345' }));
    expect(amount.ok).toBe(false);
    if (amount.ok) return;
    expect(amount.fieldErrors).toContainEqual({ field: 'totalBudgetDollars', message: CAMPAIGN_AMOUNT_MESSAGE });

    const blankLabel = parseCampaignEditorForm(form({ prizes: [{ label: '   ', quantity: '1', unitValueDollars: '1' }] }));
    expect(blankLabel.ok).toBe(false);
    if (blankLabel.ok) return;
    expect(blankLabel.fieldErrors).toContainEqual({ field: 'prizes.0.label', message: 'Enter a prize label.' });

    const quarter = parseCampaignEditorForm(form({ quarterKey: '2027-Q5' }));
    expect(quarter.ok).toBe(false);
    if (quarter.ok) return;
    expect(quarter.fieldErrors).toContainEqual({ field: 'quarterKey', message: 'Choose a quarter.' });
  });

  it('accepts quantity 1 and 1000', () => {
    for (const quantity of ['1', '1000']) {
      const parsed = parseCampaignEditorForm(form({ prizes: [{ label: 'Dinner', quantity, unitValueDollars: '1' }] }));
      expect(parsed.ok, quantity).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.draft.prizes[0]?.quantity).toBe(Number(quantity));
    }
  });
});

describe('committedPreview', () => {
  it('treats an equal total as within budget and a higher commitment as over', () => {
    const equal = committedPreview(form());
    expect(equal).toMatchObject({
      committedCents: 10_000,
      totalBudgetCents: 10_000,
      over: false,
      label: 'Committed $100.00 of $100.00 budget',
    });
    const over = committedPreview(form({ fulfillmentAllowanceDollars: '30' }));
    expect(over).toMatchObject({
      committedCents: 11_000,
      totalBudgetCents: 10_000,
      over: true,
      label: 'Committed $110.00 of $100.00 budget',
    });
  });

  it('does not mark the line over when an amount cannot be parsed', () => {
    const preview = committedPreview(form({ totalBudgetDollars: 'abc' }));
    expect(preview.over).toBe(false);
    expect(preview.totalBudgetCents).toBeNull();
    expect(preview.label).toBe('Committed $100.00 of — budget');
  });
});

describe('quarterOptions and campaignWindowLabel', () => {
  it('offers the current Chicago quarter and the next three', () => {
    expect(quarterOptions('2026-11-12T18:00:00.000Z')).toEqual(['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3']);
    expect(quarterOptions('2026-12-31T23:30:00-06:00')).toEqual(['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3']);
    expect(quarterOptions('2027-01-01T05:30:00.000Z')).toEqual(['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3']);
    expect(quarterOptions('2027-01-01T06:00:00.000Z')).toEqual(['2027-Q1', '2027-Q2', '2027-Q3', '2027-Q4']);
    expect(quarterOptions('not-a-date')).toEqual([]);
  });

  it('shows the inclusive Chicago dates for 2027-Q1', () => {
    expect(campaignWindowLabel('2027-Q1')).toBe('Jan 1, 2027 – Mar 31, 2027');
    expect(campaignWindowLabel('2026-Q4')).toBe('Oct 1, 2026 – Dec 31, 2026');
    expect(campaignWindowLabel('2027-Q5')).toBeNull();
  });

  it('returns the same quarters under TZ=UTC and TZ=America/Chicago', () => {
    const tsx = path.join(ROOT, 'node_modules', '.bin', 'tsx');
    const probe = 'src/lib/drawings/campaign-editor.tz-probe.ts';
    const run = (tz: string) => {
      const result = spawnSync(tsx, [probe], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, TZ: tz },
      });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout) as { quarters: Record<string, string[]> };
    };
    const utc = run('UTC');
    const chicago = run('America/Chicago');
    expect(chicago.quarters).toEqual(utc.quarters);
    expect(utc.quarters['2026-12-31T23:30:00-06:00']?.[0]).toBe('2026-Q4');
    expect(utc.quarters['2027-01-01T05:30:00.000Z']?.[0]).toBe('2026-Q4');
    expect(utc.quarters['2026-11-12T18:00:00.000Z']).toEqual(['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3']);
  });
});

describe('campaignEditorMessage', () => {
  it('has a plain message for every campaign code and store error', () => {
    const codes = [...CAMPAIGN_ERROR_CODES, 'not_found', 'unavailable', 'quarter_campaign_open', 'campaign_locked', 'invalid_transition', 'live_activation_blocked', 'campaign_window_ended', 'no_prizes', 'disabled', 'forbidden', 'invalid_form'] as const;
    for (const code of codes) {
      const message = campaignEditorMessage(code);
      expect(message, code).not.toBe(code);
      expect(message.length, code).toBeGreaterThan(0);
      if (code !== 'unavailable') expect(message, code).not.toContain(code);
    }
    expect(campaignEditorMessage('quarter_campaign_open')).toBe('A campaign for that quarter is already open.');
    expect(campaignEditorMessage('unavailable')).toBe('Drawing records are unavailable.');
  });
});

describe('campaignEditorSeed', () => {
  it('turns stored cents into dollar inputs without a thousands separator', () => {
    expect(
      campaignEditorSeed({
        quarterKey: '2027-Q1',
        totalBudgetCents: 10_000,
        allowanceCents: 2_000,
        prizes: [{ label: 'Sample prize: Dinner for two', quantity: 2, unitValueCents: 4_000 }],
      }),
    ).toEqual({
      quarterKey: '2027-Q1',
      totalBudgetDollars: '100.00',
      fulfillmentAllowanceDollars: '20.00',
      prizes: [{ label: 'Sample prize: Dinner for two', quantity: '2', unitValueDollars: '40.00' }],
    });
  });
});
