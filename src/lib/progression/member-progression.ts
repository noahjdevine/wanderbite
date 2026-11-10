import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import {
  summarizeMemberProgression,
  type MemberProgressionSummary,
} from '@/lib/progression/read-model';

/**
 * Loads the signed-in member's own ledger through the request-scoped server
 * client (`createClient` from `src/lib/supabase/server`). RLS still limits
 * the read to that member. This module does not import the service-role
 * client, does not write, and does not read `E09_PROGRESSION_LEDGER_ENABLED`.
 * JourneyContent calls it when `E09_MEMBER_PROGRESSION_UI_ENABLED` is exactly `true`.
 * This module does not read that flag.
 *
 * The three ledger tables are not in database.types.ts. The query below uses
 * a local reader shape. Do not run `npm run types:db` for this.
 */

const EVENT_COLUMNS = 'schedule_version, source_kind';
const MILESTONE_COLUMNS = 'id, milestone_key, schedule_version, level, reached_at, quarter_key';
const ENTRY_COLUMNS = 'milestone_id, quarter_key, entry_source';

const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

const TABLES = {
  events: { name: 'progression_events', columns: EVENT_COLUMNS },
  milestones: { name: 'progression_milestones', columns: MILESTONE_COLUMNS },
  entries: { name: 'progression_drawing_entries', columns: ENTRY_COLUMNS },
} as const;

type LedgerTable = (typeof TABLES)[keyof typeof TABLES]['name'];

type LedgerPage = {
  data: unknown[] | null;
  error: { message?: string } | null;
};

type LedgerQuery = {
  select: (columns: string) => {
    eq: (
      column: 'user_id',
      value: string,
    ) => {
      order: (column: 'id') => {
        range: (from: number, to: number) => PromiseLike<LedgerPage>;
      };
    };
  };
};

type LedgerReader = {
  auth: {
    getUser: () => PromiseLike<{
      data: { user: { id: string } | null };
      error: { message?: string } | null;
    }>;
  };
  from: (table: LedgerTable) => LedgerQuery;
};

export type MemberProgressionLoadResult =
  | { ok: true; summary: MemberProgressionSummary }
  | { ok: false; error: 'signed_out' | 'unavailable' };

function reader(supabase: SupabaseClient<Database>): LedgerReader {
  return supabase as unknown as LedgerReader;
}

async function readOwnRows(
  ledger: LedgerReader,
  table: LedgerTable,
  columns: string,
  userId: string,
): Promise<unknown[] | null> {
  const rows: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let result: LedgerPage;
    try {
      result = await ledger
        .from(table)
        .select(columns)
        .eq('user_id', userId)
        .order('id')
        .range(from, to);
    } catch {
      return null;
    }
    if (result.error || !Array.isArray(result.data)) return null;
    rows.push(...result.data);
    if (result.data.length < PAGE_SIZE) return rows;
  }
  return null;
}

/**
 * Reads the session user's ledger rows and summarizes them.
 * No session is `signed_out`. A failed read is `unavailable`.
 * A member with no rows gets the empty summary and does not throw.
 */
export async function loadMemberProgression(
  supabase: SupabaseClient<Database>,
): Promise<MemberProgressionLoadResult> {
  const ledger = reader(supabase);
  let userId: string | null = null;
  try {
    const { data } = await ledger.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  if (!userId) return { ok: false, error: 'signed_out' };

  const [events, milestones, entries] = await Promise.all([
    readOwnRows(ledger, TABLES.events.name, TABLES.events.columns, userId),
    readOwnRows(ledger, TABLES.milestones.name, TABLES.milestones.columns, userId),
    readOwnRows(ledger, TABLES.entries.name, TABLES.entries.columns, userId),
  ]);
  if (events === null || milestones === null || entries === null) {
    return { ok: false, error: 'unavailable' };
  }
  return {
    ok: true,
    summary: summarizeMemberProgression({ events, milestones, entries }),
  };
}
