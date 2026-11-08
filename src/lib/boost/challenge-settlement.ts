import 'server-only';

import { arrivalSessionsEnabled } from '@/lib/boost/flag';
import {
  recordedBoostSettlementFromRow,
  SETTLEMENT_COLUMNS,
  type StoredRedemptionSettlement,
} from '@/lib/boost/settlement-store';
import { storedCentsFromParsedSettlement } from '@/lib/progress/savings-cents';

type SettlementRow = StoredRedemptionSettlement & { id: string };

type SettlementRead = {
  from: (table: string) => {
    select: (columns: string) => {
      in: (
        column: string,
        values: readonly string[],
      ) => PromiseLike<{ data: SettlementRow[] | null; error: { message: string } | null }>;
    };
  };
};

/**
 * Read stored settlement cents for challenge cards.
 * The arrival flag must be exactly `true`. Otherwise this does not query.
 * A missing column, a sealed miss, or a row the parser rejects is omitted.
 * This does not insert, update, or recompute a quote.
 */
export async function loadStoredChallengeSavings(
  supabase: SettlementRead,
  redemptionIds: readonly string[],
): Promise<Map<string, number>> {
  const saved = new Map<string, number>();
  if (!arrivalSessionsEnabled() || redemptionIds.length === 0) return saved;
  try {
    const { data, error } = await supabase
      .from('redemptions')
      .select(`id, ${SETTLEMENT_COLUMNS}`)
      .in('id', redemptionIds);
    if (error) {
      console.error('[challenges] settlement read:', error.message);
      return saved;
    }
    for (const row of data ?? []) {
      const cents = storedCentsFromParsedSettlement(recordedBoostSettlementFromRow(row));
      if (cents != null && row.id) saved.set(row.id, cents);
    }
    return saved;
  } catch (error) {
    console.error(
      '[challenges] settlement read:',
      error instanceof Error ? error.message : 'unknown',
    );
    return saved;
  }
}
