import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe('credit-safe swap action', () => {
  const swap = source('src/app/actions/swap-challenge.ts');
  const credits = between(
    swap,
    'async function swapLinkedCreditItem',
    'Swap one challenge item for a new restaurant.',
  );
  const retry = between(swap, 'async function retryLinkedCreditSwap', 'async function swapLinkedCreditItem');
  const finish = between(swap, 'async function finishCreditSwap', 'async function retryLinkedCreditSwap');
  const legacy = swap.slice(swap.indexOf('export async function swapChallengeItem'));

  it('routes credits through swap_linked_credit_item and leaves legacy on the old RPC', () => {
    expect(legacy).toContain('swapLinkedCreditItem');
    expect(legacy).toMatch(/rpc\('swap_challenge_item'/);
    expect(legacy).toContain('loadRestaurantOffer');
    expect(legacy).toContain('isValidSuccessorLineage');
    expect(finish).toMatch(/rpc\('swap_linked_credit_item'/);
    expect(finish).toContain('loadSealedSuccessorOffer');
    expect(finish).not.toContain('loadRestaurantOffer');
    expect(credits).not.toContain('loadRestaurantOffer');
    expect(swap).not.toContain('assign_carried_credit');
  });

  it('calls the RPC with a null replacement before pool selection on a swapped_out retry', () => {
    expect(credits.indexOf("status === 'swapped_out'")).toBeGreaterThan(-1);
    expect(credits.indexOf('retryLinkedCreditSwap')).toBeLessThan(credits.indexOf('selectDistancePool'));
    expect(credits.indexOf('linkedRedeemableRestaurantIds')).toBeLessThan(
      credits.indexOf('selectDistancePool'),
    );
    expect(retry).toContain('null');
    expect(retry).not.toContain('selectDistancePool');
    expect(retry).not.toContain('loadRestaurantOffer');
    expect(retry).not.toContain('credit_swap_allowances');
  });

  it('does not precheck the monthly allowance or admit flat offers on the credits path', () => {
    expect(credits).not.toContain('credit_swap_allowances');
    expect(credits).not.toContain('swap_count_used');
    expect(credits).not.toContain("from('restaurant_offers')");
    expect(credits).toContain('lowestSealedBase');
    expect(credits).toContain('2000');
    expect(swap).toContain('below_floor');
    expect(swap).toContain('pair_below_floor');
    expect(swap).toContain('capacity_full');
    expect(swap).toContain('swap_exhausted');
    expect(legacy).toContain("from('restaurant_offers')");
  });
});

describe('reset-swap-counters Chicago boundary', () => {
  const route = source('src/app/api/cron/reset-swap-counters/route.ts');
  const issue = source('src/app/api/cron/issue-monthly-challenges/route.ts');
  const period = source('src/lib/cron-period.ts');

  it('guards and keys only this job on the Chicago month', () => {
    expect(route.indexOf('resetSwapCountersMonthOpen')).toBeLessThan(route.indexOf('runLeasedCron'));
    expect(route).toContain('resetSwapCountersRunKey');
    expect(route).toContain('chicago_month_not_open');
    expect(route).toContain("eq('workflow_version', 'legacy')");
    expect(route).toContain('chicagoMonthStart');
    expect(route).not.toContain('monthlyRunKey');
    expect(issue).toContain('monthlyRunKey');
    expect(issue).not.toContain('resetSwapCountersRunKey');
    expect(period).toMatch(/export function monthlyRunKey[\s\S]*startOfMonth\(now\)/);
    expect(source('vercel.json')).toContain('"schedule": "5 6 1 * *"');
  });
});
