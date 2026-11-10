import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  formatProgressionBackfillCounts,
  parseProgressionBackfillArgs,
  progressionBackfillAllowed,
  readBackfillCounts,
} from '../src/lib/progression/backfill';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });

const HELP = `Operator-only progression ledger backfill.

Default is a dry run. It writes nothing. Pass --apply to write.
--entries-from YYYY-MM-DD is required. There is no default date.
The date is America/Chicago midnight.

  npm run progression:backfill -- --entries-from YYYY-MM-DD
  npm run progression:backfill -- --entries-from YYYY-MM-DD --apply
  npm run progression:backfill -- --entries-from YYYY-MM-DD --user-id <uuid> --apply

The script prints counts only. It does not print emails, member ids, or tokens.
It refuses a hosted Supabase URL. It does not apply migrations.
Apply supabase/migrations/20261110183232_e09_a4_progression_backfill.sql on the
local database first. This script does not apply it.
E09_PROGRESSION_LEDGER_ENABLED stays unset. This script does not set it.
`;

type BackfillRpc = {
  rpc: (
    fn: 'backfill_verified_visit_progress',
    args: {
      p_entries_from: string;
      p_user_id: string | null;
      p_dry_run: boolean;
    },
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function redact(line: string): string {
  return line
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/bearer\s+\S+/gi, 'bearer [redacted]');
}

function fail(message: string): never {
  process.stderr.write(`${redact(message)}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const parsed = parseProgressionBackfillArgs(process.argv.slice(2));
  if ('error' in parsed) fail(parsed.error);
  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const allowed = progressionBackfillAllowed(supabaseUrl);
  if (!allowed.ok) fail(allowed.reason);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!key) fail('Refused. SUPABASE_SERVICE_ROLE_KEY is not set.');
  // The RPC is not in database.types.ts. This script does not run types:db.
  const supabase = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as BackfillRpc;
  const { data, error } = await supabase.rpc('backfill_verified_visit_progress', {
    p_entries_from: parsed.entriesFrom,
    p_user_id: parsed.userId,
    p_dry_run: !parsed.apply,
  });
  if (error) fail(redact(error.message));
  const counts = readBackfillCounts(data);
  if (!counts) fail('backfill returned an unexpected count payload');
  process.stdout.write(formatProgressionBackfillCounts(counts, !parsed.apply));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'progression backfill failed';
  fail(redact(message));
});
