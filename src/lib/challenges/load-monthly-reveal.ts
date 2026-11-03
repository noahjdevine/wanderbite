import { curationConstraintLines, reasonsFromRevealJson, type MonthlyRevealPanel } from '@/lib/challenges/monthly-reveal-copy';
import { logRevealUnavailableOnce, monthlyRevealEnabled, revealSchemaMissing } from '@/lib/challenges/monthly-reveal-flag';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const REVEAL_INSTEAD_ERROR = 'Open Challenges and choose Reveal my challenges for this month.';

export function revealInsteadError(): string {
  return REVEAL_INSTEAD_ERROR;
}

/**
 * True only when the flag is on and challenge_reveals can be read.
 * A missing table or function logs once and leaves today’s generator in place.
 */
export async function revealSchemaAvailable(): Promise<boolean> {
  if (!monthlyRevealEnabled()) return false;
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from('challenge_reveals').select('id').limit(1);
    if (!error) return true;
    logRevealUnavailableOnce();
    return false;
  } catch {
    logRevealUnavailableOnce();
    return false;
  }
}

/** Member Generate Challenge is closed only while the reveal schema is actually available. */
export async function memberGenerateBlocked(): Promise<boolean> {
  return revealSchemaAvailable();
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
    logRevealUnavailableOnce();
    return { mode: 'off' };
  }
}

async function loadMonthlyRevealPanel(args: {
  userId: string;
  cycleMonth: string | null;
  showCuration: boolean;
}): Promise<MonthlyRevealPanel> {
  if (!(await revealSchemaAvailable())) return { mode: 'off' };

  const admin = getSupabaseAdmin();
  if (args.cycleMonth) {
    const { data, error } = await admin
      .from('challenge_reveals')
      .select('item_reasons')
      .eq('user_id', args.userId)
      .eq('period_key', args.cycleMonth)
      .maybeSingle();
    if (error) {
      if (revealSchemaMissing(error)) logRevealUnavailableOnce();
      return { mode: 'revealed', reasons: [] };
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
