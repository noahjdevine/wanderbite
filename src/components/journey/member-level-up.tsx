import { LevelUpCelebration } from '@/components/journey/level-up-celebration';
import { memberProgressionUiEnabled } from '@/lib/progression/flag';
import { loadMemberProgression } from '@/lib/progression/member-progression';
import type { MemberProgressionMilestone } from '@/lib/progression/read-model';
import { createClient } from '@/lib/supabase/server';

/**
 * One level-up dialog on the pages a member opens after a visit.
 * The flag is checked before any ledger read. Journey's panel uses the same
 * dialog and the same seen keys, so a level shows once in this browser.
 * A failed read adds nothing. This does not award XP, a badge, or an entry.
 */
export async function MemberLevelUpCelebration() {
  if (!memberProgressionUiEnabled()) return null;
  let milestones: readonly MemberProgressionMilestone[] | null = null;
  try {
    const supabase = await createClient();
    const loaded = await loadMemberProgression(supabase);
    milestones = loaded.ok ? loaded.summary.milestones : null;
  } catch {
    return null;
  }
  if (!milestones) return null;
  return <LevelUpCelebration enabled milestones={milestones} />;
}
