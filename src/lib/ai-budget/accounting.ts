export type RouletteAccountAction =
  | 'settle'
  | 'assumed_spent_reconcile'
  | 'assumed_spent_release'
  | 'fail_before_dispatch';

/**
 * Decide the ledger path for a roulette provider outcome.
 * actual>quoted is handled after settle throws — never settle unusable output.
 */
export function classifyRouletteAccounting(args: {
  dispatched: boolean;
  pickValid: boolean;
  usage: Record<string, number> | null;
}): RouletteAccountAction {
  if (!args.dispatched) return 'fail_before_dispatch';
  if (!args.usage) return 'assumed_spent_release';
  if (args.pickValid) return 'settle';
  return 'assumed_spent_reconcile';
}
