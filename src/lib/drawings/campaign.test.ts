import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chicagoQuarterKey } from '@/lib/progression/quarter';
import {
  SAMPLE_PRIZE_MARKER,
  campaignWindow,
  checkCampaignEdit,
  checkCampaignTransition,
  displayPrizeLabel,
  validateCampaignDraft,
  type CampaignDraft,
  type CampaignPrize,
  type CampaignTransitionState,
} from '@/lib/drawings/campaign';

/** 2 × $50 plus $20 fulfillment against a $120 authorized total. */
function budgetDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    quarterKey: '2026-Q4',
    mode: 'live',
    rulesVersion: 'v0',
    totalBudgetCents: 12_000,
    fulfillmentAllowanceCents: 2_000,
    prizes: [
      {
        label: 'Gift card',
        quantity: 2,
        unitValueCents: 5_000,
        isSample: false,
      },
    ],
    eligibleEntrySources: ['level_milestone'],
    ...overrides,
  };
}

function samplePrize(overrides: Partial<CampaignPrize> = {}): CampaignPrize {
  return {
    label: `${SAMPLE_PRIZE_MARKER}: Gift card`,
    quantity: 2,
    unitValueCents: 5_000,
    isSample: true,
    ...overrides,
  };
}

function sampleDraft(overrides: Partial<CampaignDraft> = {}): CampaignDraft {
  return budgetDraft({
    mode: 'sample',
    prizes: [samplePrize()],
    ...overrides,
  });
}

describe('validateCampaignDraft budget', () => {
  it('accepts 2 × $50 plus $20 fulfillment against a $120 total', () => {
    expect(validateCampaignDraft(budgetDraft())).toEqual({ ok: true, committedCents: 12_000 });
  });

  it('accepts a committed total that equals the authorized total', () => {
    const draft = budgetDraft({ totalBudgetCents: 12_000, fulfillmentAllowanceCents: 0, prizes: [
      { label: 'Gift card', quantity: 1, unitValueCents: 12_000, isSample: false },
    ] });
    expect(validateCampaignDraft(draft)).toEqual({ ok: true, committedCents: 12_000 });
  });

  it('rejects a $119.99 total with over_budget', () => {
    const result = validateCampaignDraft(budgetDraft({ totalBudgetCents: 11_999 }));
    expect(result).toEqual({ ok: false, errors: ['over_budget'] });
  });

  it('rejects a sample campaign with the same over-budget total', () => {
    const result = validateCampaignDraft(sampleDraft({ totalBudgetCents: 11_999 }));
    expect(result).toEqual({ ok: false, errors: ['over_budget'] });
  });
});

describe('checkCampaignEdit', () => {
  it('rejects an added prize that pushes the edit over the authorized total', () => {
    const current = budgetDraft();
    expect(validateCampaignDraft(current).ok).toBe(true);
    const next = budgetDraft({
      prizes: [
        ...current.prizes,
        { label: 'Extra gift card', quantity: 1, unitValueCents: 5_000, isSample: false },
      ],
    });
    expect(checkCampaignEdit(current, next)).toEqual({ ok: false, errors: ['over_budget'] });
  });

  it('rejects a total lowered below the cents still committed', () => {
    const current = budgetDraft({ totalBudgetCents: 20_000 });
    const next = budgetDraft({ totalBudgetCents: 11_999 });
    expect(validateCampaignDraft(current)).toEqual({ ok: true, committedCents: 12_000 });
    const result = checkCampaignEdit(current, next);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual(['over_budget']);
  });

  it('allows a lower total that still covers the same commitment', () => {
    const current = budgetDraft({ totalBudgetCents: 20_000 });
    const next = budgetDraft({ totalBudgetCents: 12_000 });
    expect(checkCampaignEdit(current, next)).toEqual({ ok: true, committedCents: 12_000 });
  });

  it('allows a higher total when the edit adds a prize that still fits', () => {
    const current = budgetDraft();
    const next = budgetDraft({
      totalBudgetCents: 17_000,
      prizes: [
        ...current.prizes,
        { label: 'Extra gift card', quantity: 1, unitValueCents: 5_000, isSample: false },
      ],
    });
    expect(checkCampaignEdit(current, next)).toEqual({ ok: true, committedCents: 17_000 });
  });

  it('accepts a fitting edit when the current draft is over budget', () => {
    const current = budgetDraft({ totalBudgetCents: 11_999 });
    const next = budgetDraft({ totalBudgetCents: 12_000 });
    expect(checkCampaignEdit(current, next)).toEqual({ ok: true, committedCents: 12_000 });
  });
});

describe('validateCampaignDraft field errors', () => {
  it('rejects non-integer, negative, and NaN cents without throwing', () => {
    expect(() =>
      validateCampaignDraft(budgetDraft({ totalBudgetCents: Number.NaN })),
    ).not.toThrow();
    expect(validateCampaignDraft(budgetDraft({ totalBudgetCents: Number.NaN }))).toEqual({
      ok: false,
      errors: ['non_integer_cents'],
    });
    expect(validateCampaignDraft(budgetDraft({ fulfillmentAllowanceCents: Number.POSITIVE_INFINITY }))).toEqual({
      ok: false,
      errors: ['non_integer_cents'],
    });
    expect(validateCampaignDraft(budgetDraft({ totalBudgetCents: 119.99 }))).toEqual({
      ok: false,
      errors: ['non_integer_cents'],
    });
    expect(
      validateCampaignDraft(
        budgetDraft({
          prizes: [{ label: 'Gift card', quantity: 2, unitValueCents: -1, isSample: false }],
        }),
      ),
    ).toEqual({ ok: false, errors: ['negative_cents'] });
    expect(validateCampaignDraft(budgetDraft({ fulfillmentAllowanceCents: -20 }))).toEqual({
      ok: false,
      errors: ['negative_cents'],
    });
  });

  it('rejects zero, negative, and non-integer quantities without throwing', () => {
    const cases: [number, string][] = [
      [0, 'zero_quantity'],
      [-2, 'negative_quantity'],
      [1.5, 'non_integer_quantity'],
      [Number.NaN, 'non_integer_quantity'],
    ];
    for (const [quantity, code] of cases) {
      expect(() =>
        validateCampaignDraft(
          budgetDraft({
            prizes: [{ label: 'Gift card', quantity, unitValueCents: 5_000, isSample: false }],
          }),
        ),
      ).not.toThrow();
      expect(
        validateCampaignDraft(
          budgetDraft({
            prizes: [{ label: 'Gift card', quantity, unitValueCents: 5_000, isSample: false }],
          }),
        ),
      ).toEqual({ ok: false, errors: [code] });
    }
  });

  it('rejects empty prizes and a malformed quarter key without throwing', () => {
    expect(() => validateCampaignDraft(budgetDraft({ prizes: [] }))).not.toThrow();
    expect(validateCampaignDraft(budgetDraft({ prizes: [] }))).toEqual({
      ok: false,
      errors: ['empty_prizes'],
    });

    for (const quarterKey of ['2026-Q5', '2026-q4', '2026-Q04', 'Q4-2026', '', '2026-Q4 ']) {
      expect(() => validateCampaignDraft(budgetDraft({ quarterKey }))).not.toThrow();
      expect(validateCampaignDraft(budgetDraft({ quarterKey }))).toEqual({
        ok: false,
        errors: ['invalid_quarter_key'],
      });
    }
  });

  it('reports each problem code once and does not throw on a mixed draft', () => {
    const draft = budgetDraft({
      quarterKey: 'not-a-quarter',
      totalBudgetCents: Number.NaN,
      fulfillmentAllowanceCents: -20,
      prizes: [{ label: 'Gift card', quantity: 0, unitValueCents: 1.5, isSample: false }],
      eligibleEntrySources: ['recipes'],
    });
    expect(() => validateCampaignDraft(draft)).not.toThrow();
    expect(validateCampaignDraft(draft)).toEqual({
      ok: false,
      errors: [
        'invalid_quarter_key',
        'non_integer_cents',
        'negative_cents',
        'zero_quantity',
        'unknown_entry_source',
      ],
    });
  });

  it('does not throw when the draft itself is unusable', () => {
    expect(() => validateCampaignDraft(null as unknown as CampaignDraft)).not.toThrow();
    const result = validateCampaignDraft(null as unknown as CampaignDraft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('invalid_quarter_key');
      expect(result.errors).toContain('empty_prizes');
      expect(result.errors).toContain('unknown_entry_source');
    }
  });
});

describe('sample and live prize labels', () => {
  it('requires every sample prize to be marked, and prefixes the display label', () => {
    expect(validateCampaignDraft(sampleDraft())).toEqual({ ok: true, committedCents: 12_000 });

    const unlabeled = sampleDraft({
      prizes: [samplePrize({ label: 'Gift card', isSample: true })],
    });
    expect(validateCampaignDraft(unlabeled)).toEqual({
      ok: false,
      errors: ['sample_label_required'],
    });

    const notSample = sampleDraft({
      prizes: [samplePrize({ isSample: false })],
    });
    expect(validateCampaignDraft(notSample)).toEqual({
      ok: false,
      errors: ['sample_prize_required'],
    });

    const labels = ['Gift card', `${SAMPLE_PRIZE_MARKER}: Gift card`, 'Win a Sample prize'].map((label) =>
      displayPrizeLabel({ label }, 'sample'),
    );
    expect(labels.every((label) => label.startsWith(SAMPLE_PRIZE_MARKER))).toBe(true);
    expect(displayPrizeLabel({ label: `${SAMPLE_PRIZE_MARKER}: Gift card` }, 'sample')).toBe(
      `${SAMPLE_PRIZE_MARKER}: Gift card`,
    );
    expect(displayPrizeLabel({ label: 'Gift card' }, 'sample')).toBe(`${SAMPLE_PRIZE_MARKER}: Gift card`);
  });

  it('rejects a sample prize on a live campaign and does not prefix live labels', () => {
    const result = validateCampaignDraft(
      budgetDraft({
        prizes: [{ label: `${SAMPLE_PRIZE_MARKER}: Gift card`, quantity: 2, unitValueCents: 5_000, isSample: true }],
      }),
    );
    expect(result).toEqual({ ok: false, errors: ['live_sample_prize'] });
    expect(displayPrizeLabel({ label: 'Gift card' }, 'live')).toBe('Gift card');
    expect(displayPrizeLabel({ label: `${SAMPLE_PRIZE_MARKER}: Gift card` }, 'live')).toBe(
      `${SAMPLE_PRIZE_MARKER}: Gift card`,
    );
  });
});

describe('entry sources', () => {
  it('allows level_milestone and rejects reviews, QR issuance, and recipes', () => {
    expect(validateCampaignDraft(budgetDraft({ eligibleEntrySources: ['level_milestone'] })).ok).toBe(true);

    expect(validateCampaignDraft(budgetDraft({ eligibleEntrySources: ['reviews'] }))).toEqual({
      ok: false,
      errors: ['public_review_entry'],
    });
    expect(validateCampaignDraft(budgetDraft({ eligibleEntrySources: ['public_review'] }))).toEqual({
      ok: false,
      errors: ['public_review_entry'],
    });
    expect(validateCampaignDraft(budgetDraft({ eligibleEntrySources: ['QR issuance'] }))).toEqual({
      ok: false,
      errors: ['unknown_entry_source'],
    });
    expect(validateCampaignDraft(budgetDraft({ eligibleEntrySources: ['recipes'] }))).toEqual({
      ok: false,
      errors: ['unknown_entry_source'],
    });
    expect(
      validateCampaignDraft(
        budgetDraft({ eligibleEntrySources: ['level_milestone', 'reviews', 'recipes'] }),
      ),
    ).toEqual({
      ok: false,
      errors: ['public_review_entry', 'unknown_entry_source'],
    });
    expect(validateCampaignDraft(budgetDraft({ eligibleEntrySources: [] }))).toEqual({
      ok: false,
      errors: ['unknown_entry_source'],
    });
  });
});

describe('campaignWindow', () => {
  it('bounds 2026-Q4 on the America/Chicago calendar, including the November DST change', () => {
    const window = campaignWindow('2026-Q4');
    expect(window).toEqual({
      startsAt: '2026-10-01T05:00:00.000Z',
      endsAt: '2027-01-01T06:00:00.000Z',
    });
    if (!window) return;

    expect(chicagoWall(window.startsAt)).toBe('2026-10-01 00:00');
    expect(chicagoWall(window.endsAt)).toBe('2027-01-01 00:00');
    expect(chicagoQuarterKey(window.startsAt)).toBe('2026-Q4');
    expect(chicagoQuarterKey(new Date(Date.parse(window.startsAt) - 1).toISOString())).toBe('2026-Q3');
    expect(chicagoQuarterKey(new Date(Date.parse(window.endsAt) - 1).toISOString())).toBe('2026-Q4');
    expect(chicagoQuarterKey(window.endsAt)).toBe('2027-Q1');

    // Fall back is Sunday 2026-11-01. Both copies of 01:30 sit inside Q4.
    // The UTC span is 92 days plus the repeated hour, so a fixed offset cannot pass.
    const firstFold = Date.parse('2026-11-01T06:30:00.000Z');
    const secondFold = Date.parse('2026-11-01T07:30:00.000Z');
    const start = Date.parse(window.startsAt);
    const end = Date.parse(window.endsAt);
    expect(firstFold).toBeGreaterThanOrEqual(start);
    expect(secondFold).toBeLessThan(end);
    expect(chicagoQuarterKey('2026-11-01T06:30:00.000Z')).toBe('2026-Q4');
    expect(chicagoQuarterKey('2026-11-01T07:30:00.000Z')).toBe('2026-Q4');
    expect(end - start).toBe((92 * 24 + 1) * 60 * 60 * 1000);
  });

  it('meets the next quarter at the same instant and covers the March DST change', () => {
    const q1 = campaignWindow('2026-Q1');
    const q2 = campaignWindow('2026-Q2');
    expect(q1).toEqual({
      startsAt: '2026-01-01T06:00:00.000Z',
      endsAt: '2026-04-01T05:00:00.000Z',
    });
    expect(q2?.startsAt).toBe(q1?.endsAt);
    if (!q1) return;
    expect(chicagoQuarterKey(new Date(Date.parse(q1.endsAt) - 1).toISOString())).toBe('2026-Q1');
    expect(chicagoQuarterKey(q1.endsAt)).toBe('2026-Q2');
    const springForward = Date.parse('2026-03-08T08:30:00.000Z');
    expect(springForward).toBeGreaterThan(Date.parse(q1.startsAt));
    expect(springForward).toBeLessThan(Date.parse(q1.endsAt));
  });

  it('returns null for a malformed quarter key and does not throw', () => {
    expect(() => campaignWindow('2026-Q5')).not.toThrow();
    expect(campaignWindow('2026-Q5')).toBeNull();
    expect(campaignWindow('')).toBeNull();
  });
});

function transitionState(overrides: Partial<CampaignTransitionState> = {}): CampaignTransitionState {
  return {
    status: 'draft',
    mode: 'sample',
    endsAt: '2027-04-01T05:00:00.000Z',
    prizeCount: 1,
    totalBudgetCents: 12_000,
    committedCents: 12_000,
    ...overrides,
  };
}

describe('checkCampaignTransition', () => {
  it('allows a sample draft just before the quarter ends and rejects the end instant', () => {
    const boundaries = [
      {
        endsAt: '2027-01-01T06:00:00.000Z',
        before: '2027-01-01T05:59:59.999Z',
        after: '2027-01-01T06:00:00.001Z',
      },
      {
        endsAt: '2027-04-01T05:00:00.000Z',
        before: '2027-04-01T04:59:59.999Z',
        after: '2027-04-01T05:00:00.001Z',
      },
    ];
    for (const boundary of boundaries) {
      const state = transitionState({ endsAt: boundary.endsAt });
      expect(checkCampaignTransition(state, 'active', boundary.before)).toEqual({ ok: true });
      expect(checkCampaignTransition(state, 'active', boundary.endsAt)).toEqual({
        ok: false,
        error: 'campaign_window_ended',
      });
      expect(checkCampaignTransition(state, 'active', boundary.after)).toEqual({
        ok: false,
        error: 'campaign_window_ended',
      });
    }
  });

  it('allows draft → closed and active → closed, and rejects every other move', () => {
    expect(checkCampaignTransition(transitionState(), 'closed', '2027-02-01T00:00:00.000Z')).toEqual({
      ok: true,
    });
    expect(
      checkCampaignTransition(transitionState({ status: 'active' }), 'closed', '2027-06-01T00:00:00.000Z'),
    ).toEqual({ ok: true });
    const rejected: Array<[CampaignTransitionState['status'], string]> = [
      ['draft', 'draft'],
      ['draft', 'paused'],
      ['active', 'draft'],
      ['active', 'active'],
      ['closed', 'active'],
      ['closed', 'draft'],
      ['closed', 'closed'],
    ];
    for (const [status, toStatus] of rejected) {
      expect(checkCampaignTransition(transitionState({ status }), toStatus, '2027-02-01T00:00:00.000Z')).toEqual({
        ok: false,
        error: 'invalid_transition',
      });
    }
  });

  it('uses the same activation order as the database', () => {
    const now = '2027-02-01T00:00:00.000Z';
    const ended = '2027-04-01T05:00:00.000Z';
    expect(checkCampaignTransition(transitionState({ mode: 'live', endsAt: ended }), 'active', ended)).toEqual({
      ok: false,
      error: 'live_activation_blocked',
    });
    expect(
      checkCampaignTransition(transitionState({ endsAt: ended, prizeCount: 0 }), 'active', ended),
    ).toEqual({ ok: false, error: 'campaign_window_ended' });
    expect(
      checkCampaignTransition(
        transitionState({ prizeCount: 0, committedCents: 13_000 }),
        'active',
        now,
      ),
    ).toEqual({ ok: false, error: 'no_prizes' });
    expect(checkCampaignTransition(transitionState({ committedCents: 12_001 }), 'active', now)).toEqual({
      ok: false,
      error: 'over_budget',
    });
    expect(checkCampaignTransition(transitionState({ committedCents: 12_000 }), 'active', now)).toEqual({
      ok: true,
    });
  });
});

describe('campaign helpers stay pure', () => {
  it('does not read the database, network, or environment', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/lib/drawings/campaign.ts'), 'utf8');
    expect(source).not.toMatch(/process\.env|\bsupabase\b|\bfetch\s*\(|\bDate\.now\s*\(|new Date\(\s*\)/);
  });
});

function chicagoWall(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  let hour = pick('hour');
  if (hour === '24') hour = '00';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${hour}:${pick('minute')}`;
}
