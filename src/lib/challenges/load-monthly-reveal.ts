import { curationConstraintLines, reasonsFromRevealJson, type MonthlyRevealPanel } from '@/lib/challenges/monthly-reveal-copy';
import {
  logRevealRetryOnce,
  logRevealUnavailableOnce,
  monthlyRevealEnabled,
  revealSchemaMissing,
} from '@/lib/challenges/monthly-reveal-flag';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export type RevealSchemaState = 'off' | 'available' | 'missing' | 'unknown';

const REVEAL_INSTEAD_ERROR = 'Open Challenges and choose Reveal my challenges for this month.';

export function revealInsteadError(): string {
  return REVEAL_INSTEAD_ERROR;
}

/**
 * Flag off stays off. A missing table or function is the only fallback to today's generator.
 * Any other read failure stays closed and asks the member to try again.
 */
export async function probeRevealSchema(): Promise<RevealSchemaState> {
  if (!monthlyRevealEnabled()) return 'off';
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from('challenge_reveals').select('id').limit(1);
    if (!error) return 'available';
    if (revealSchemaMissing(error)) {
      logRevealUnavailableOnce();
      return 'missing';
    }
    logRevealRetryOnce();
    return 'unknown';
  } catch {
    logRevealRetryOnce();
    return 'unknown';
  }
}

/** True only when the flag is on and challenge_reveals can be read. */
export async function revealSchemaAvailable(): Promise<boolean> {
  return (await probeRevealSchema()) === 'available';
}

/** Blocks member Generate for a readable schema and for a non-schema read failure. */
export async function memberGenerateBlocked(): Promise<boolean> {
  const state = await probeRevealSchema();
  return state === 'available' || state === 'unknown';
}

export async function loadMonthlyRevealForChallenges(args: {
  userId: string;
  cycleMonth: string | null;
  showCuration: boolean;
}): Promise<MonthlyRevealPanel> {
  if (!monthlyRevealEnabled()) return { mode: 'off' };
  try {
    return await loadMonthlyRevealPanel(args);
  } catch {
    logRevealRetryOnce();
    return { mode: 'retry' };
  }
}

async function loadMonthlyRevealPanel(args: {
  userId: string;
  cycleMonth: string | null;
  showCuration: boolean;
}): Promise<MonthlyRevealPanel> {
  const state = await probeRevealSchema();
  if (state === 'off' || state === 'missing') return { mode: 'off' };
  if (state === 'unknown') return { mode: 'retry' };

  const admin = getSupabaseAdmin();
  if (args.cycleMonth) {
    const { data, error } = await admin
      .from('challenge_reveals')
      .select('item_reasons')
      .eq('user_id', args.userId)
      .eq('period_key', args.cycleMonth)
      .maybeSingle();
    if (error) {
      if (revealSchemaMissing(error)) {
        logRevealUnavailableOnce();
        return { mode: 'off' };
      }
      logRevealRetryOnce();
      return { mode: 'retry' };
    }
    const reasons = reasonsFromRevealJson(data?.item_reasons ?? null) ?? [];
    return { mode: 'revealed', reasons };
  }

  if (!args.showCuration) return { mode: 'off' };

  const [{ data: profile }, { data: prefs }] = await Promise.all([
    admin
      .from('user_profiles')
      .select('dietary_flags, allergy_flags, distance_band')
      .eq('id', args.userId)
      .maybeSingle(),
    admin.from('user_preferences').select('excluded_cuisines').eq('user_id', args.userId).maybeSingle(),
  ]);

  return {
    mode: 'curation',
    constraintLines: curationConstraintLines({
      distanceBand: profile?.distance_band ?? null,
      dietaryFlags: profile?.dietary_flags ?? null,
      allergyFlags: profile?.allergy_flags ?? null,
      excludedCuisines: prefs?.excluded_cuisines ?? null,
    }),
  };
}
