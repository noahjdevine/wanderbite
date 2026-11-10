import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { memberGenerateBlocked } from '@/lib/challenges/load-monthly-reveal';
import { launchAreaState, resolveProfileAddress } from '@/lib/launch-market';
import { RecipeCards } from '@/components/recipes/recipe-cards';
import {
  MemberProgressionPanel,
  MemberProgressionUnavailable,
} from '@/components/journey/progression-panel';
import { ProgressUnavailable, ProgressView } from '@/components/journey/progress-view';
import { memberProgressionUiEnabled } from '@/lib/progression/flag';
import { loadMemberProgression } from '@/lib/progression/member-progression';
import { createClient } from '@/lib/supabase/server';
import { getMemberProgress } from '@/lib/progress/get-member-progress';
import { loadProgressActivity } from '@/lib/progress/load-progress-activity';
import {
  buildProgressModel,
  headerLabelFor,
  noPairCta,
  pendingCreditsHeadFilters,
} from '@/lib/progress/progress-board';
import { SAVED_RECIPES_HEADING } from '@/lib/recipes/display';
import { loadSavedRecipes } from '@/lib/recipes/load';

type JourneyContentProps = {
  userId: string;
};

type PendingCredits =
  | { ok: true; count: number }
  | { ok: false; error: string };

/**
 * Same head count `/challenges` uses. A read error stays closed: callers must
 * not treat it as zero pending credits.
 */
async function loadPendingCredits(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  now: Date,
): Promise<PendingCredits> {
  const filters = pendingCreditsHeadFilters(userId, now);
  const { count, error } = await admin
    .from('entitlement_credits')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', filters.userId)
    .eq('issue_period', filters.issuePeriod)
    .eq('status', filters.status);
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: count ?? 0 };
}

type ProfileRow = {
  id: string;
  full_name: string | null;
  workflow_version: string | null;
  address: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
};

/**
 * The flag is checked before any ledger read. A signed-out session adds
 * nothing. A failed read shows a short message and is not logged, because
 * the error can carry a member id or a token.
 */
async function loadMemberProgressionPanel(): Promise<ReactNode> {
  if (!memberProgressionUiEnabled()) return null;
  try {
    const supabase = await createClient();
    const loaded = await loadMemberProgression(supabase);
    if (!loaded.ok) {
      return loaded.error === 'signed_out' ? null : <MemberProgressionUnavailable />;
    }
    return <MemberProgressionPanel summary={loaded.summary} />;
  } catch {
    // Leave the error out of the log. It can carry a member id or a token.
    return <MemberProgressionUnavailable />;
  }
}

export async function JourneyContent({ userId }: JourneyContentProps) {
  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('user_profiles')
    .select(
      'id, full_name, workflow_version, address, address_street, address_city, address_state, address_zip',
    )
    .eq('id', userId)
    .maybeSingle();

  if (!profile) {
    redirect('/onboarding');
  }

  const typed = profile as ProfileRow;
  const headerLabel = headerLabelFor(typed.full_name);
  const now = new Date();
  const launchEligible = launchAreaState(resolveProfileAddress(typed)) === 'eligible';
  const creditsWorkflow = typed.workflow_version === 'credits';

  const [progress, savedRecipes, activity, generateBlocked, pendingCredits, progression] =
    await Promise.all([
      getMemberProgress(userId, now),
      loadSavedRecipes(),
      loadProgressActivity(userId, now),
      memberGenerateBlocked(),
      creditsWorkflow
        ? loadPendingCredits(admin, userId, now)
        : Promise.resolve({ ok: true as const, count: 0 }),
      loadMemberProgressionPanel(),
    ]);

  const savedRecipesCard = savedRecipes.enabled ? (
    <section aria-labelledby="saved-recipes" className="flex flex-col gap-3">
      <h2 id="saved-recipes" className="wb-display m-0 text-[30px] text-wb-ink">
        {SAVED_RECIPES_HEADING}
      </h2>
      <RecipeCards
        headingId="saved-recipes-cards"
        heading={SAVED_RECIPES_HEADING}
        exclusionLine={savedRecipes.exclusionLine}
        recipes={savedRecipes.recipes}
        emptyLabel="You have not saved a recipe yet."
        showHeading={false}
      />
    </section>
  ) : null;

  if (!pendingCredits.ok) {
    return (
      <>
        <ProgressUnavailable headerLabel={headerLabel} />
        <p role="alert" className="mx-auto max-w-5xl px-5 pb-16 text-sm text-destructive sm:px-8">
          Failed to load credits: {pendingCredits.error}
        </p>
      </>
    );
  }

  if ('error' in progress) {
    return (
      <>
        <ProgressUnavailable headerLabel={headerLabel} />
        {savedRecipesCard ? (
          <div className="mx-auto max-w-5xl px-5 pb-16 sm:px-8">{savedRecipesCard}</div>
        ) : null}
      </>
    );
  }

  const model = buildProgressModel({
    progress,
    headerLabel,
    now,
    activity: activity.ok
      ? {
          ok: true,
          hasPair: activity.hasPair,
          adventures: activity.adventures,
          noPair: noPairCta({
            launchEligible,
            creditsWorkflow,
            pendingCreditsCount: pendingCredits.count,
            generateBlocked,
          }),
        }
      : { ok: false },
  });

  return (
    <ProgressView model={model} savedRecipes={savedRecipesCard} progression={progression} />
  );
}
