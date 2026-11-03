import { cycleMonthForWorkflow } from '@/lib/challenges/challenge-deadline';
import type { RevealSchemaState } from '@/lib/challenges/load-monthly-reveal';
import { launchAreaState, resolveProfileAddress } from '@/lib/launch-market';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * Same rule as /challenges: launch-eligible legacy members with no pair this
 * period see curation. Credits-workflow and out-of-area members do not.
 */
export function showsMonthlyCuration(args: {
  launchEligible: boolean;
  creditsWorkflow: boolean;
  hasCurrentPair: boolean;
}): boolean {
  return args.launchEligible && !args.creditsWorkflow && !args.hasCurrentPair;
}

export type CronRevealGate = 'off' | 'skip' | 'unknown';

/** Flag off and a missing reveal schema keep today's generator. Any other read failure does not. */
export function cronRevealGate(state: RevealSchemaState): CronRevealGate {
  if (state === 'off' || state === 'missing') return 'off';
  if (state === 'available') return 'skip';
  return 'unknown';
}

export type MonthlyIssueDecision =
  | { action: 'generate' }
  | { action: 'skip'; bucket: 'curation' | 'unknown' };

export function decideMonthlyIssue(args: {
  gate: CronRevealGate;
  showsCuration: boolean;
}): MonthlyIssueDecision {
  if (args.gate === 'off' || !args.showsCuration) return { action: 'generate' };
  return { action: 'skip', bucket: args.gate === 'unknown' ? 'unknown' : 'curation' };
}

type ProfileAddressRow = {
  workflow_version: string | null;
  address: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
};

/** True when this member would see the curation flow on /challenges right now. */
export async function memberShowsMonthlyCuration(userId: string, now = new Date()): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('user_profiles')
    .select('workflow_version, address, address_street, address_city, address_state, address_zip')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error('profile read failed');
  const profile = data as ProfileAddressRow | null;
  const creditsWorkflow = profile?.workflow_version === 'credits';
  const workflow = creditsWorkflow ? 'credits' : 'legacy';
  const launchEligible = launchAreaState(resolveProfileAddress(profile)) === 'eligible';
  const { data: cycle, error: cycleError } = await admin
    .from('challenge_cycles')
    .select('id')
    .eq('user_id', userId)
    .eq('cycle_month', cycleMonthForWorkflow(workflow, now))
    .eq('status', 'active')
    .maybeSingle();
  if (cycleError) throw new Error('cycle read failed');
  return showsMonthlyCuration({
    launchEligible,
    creditsWorkflow,
    hasCurrentPair: Boolean(cycle),
  });
}

/**
 * Flag off: generate. Flag on and curation-eligible: skip.
 * A profile or cycle read failure skips as unknown and does not generate.
 */
export async function monthlyCronSkip(
  userId: string,
  gate: CronRevealGate,
  now = new Date(),
): Promise<MonthlyIssueDecision> {
  if (gate === 'off') return { action: 'generate' };
  try {
    const showsCuration = await memberShowsMonthlyCuration(userId, now);
    return decideMonthlyIssue({ gate, showsCuration });
  } catch {
    return { action: 'skip', bucket: 'unknown' };
  }
}
