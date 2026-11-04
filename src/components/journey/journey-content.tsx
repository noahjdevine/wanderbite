import { redirect } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getUserStats } from '@/app/actions/get-user-stats';
import { getMemberProgress } from '@/lib/progress/get-member-progress';
import {
  formatEarnedOn,
  levelFromXp,
  memberHeaderLabel,
  PROGRESS_UNAVAILABLE_MESSAGE,
  XP_LEVELS,
} from '@/lib/progress/rules';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Lock } from 'lucide-react';
import { FocusVisitFromHash } from '@/components/notes/focus-visit';
import { VisitNoteRead } from '@/components/notes/visit-note';
import { RecipeCards } from '@/components/recipes/recipe-cards';
import { SAVED_RECIPES_HEADING } from '@/lib/recipes/display';
import { loadSavedRecipes } from '@/lib/recipes/load';
import { visitStatusLabel } from '@/lib/visits/visit-status';

type JourneyContentProps = {
  userId: string;
};

export async function JourneyContent({ userId }: JourneyContentProps) {
  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('user_profiles')
    .select('id, full_name')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) {
    redirect('/onboarding');
  }

  const headerLabel = memberHeaderLabel(
    (profile as { full_name: string | null }).full_name,
  );
  const [progress, statsResult, savedRecipes] = await Promise.all([
    getMemberProgress(userId),
    getUserStats(),
    loadSavedRecipes(),
  ]);
  const savedRecipesCard = savedRecipes.enabled ? (
    <Card>
      <CardHeader>
        <CardTitle>{SAVED_RECIPES_HEADING}</CardTitle>
        <CardDescription>
          Recipes you saved from a visit. Saving a recipe does not change credits or visits.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RecipeCards
          headingId="saved-recipes"
          heading={SAVED_RECIPES_HEADING}
          exclusionLine={savedRecipes.exclusionLine}
          recipes={savedRecipes.recipes}
          emptyLabel="You have not saved a recipe yet."
          showHeading={false}
        />
      </CardContent>
    </Card>
  ) : null;

  if ('error' in progress) {
    return (
      <div className="mx-auto max-w-2xl space-y-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{headerLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{PROGRESS_UNAVAILABLE_MESSAGE}</p>
          </CardContent>
        </Card>
        {savedRecipesCard}
      </div>
    );
  }

  const levelInfo = levelFromXp(progress.xp);
  const title = `Level ${levelInfo.level} ${levelInfo.name}`;
  const badges = [...progress.badges].sort((a, b) => {
    const aEarned = a.earnedAt != null;
    const bEarned = b.earnedAt != null;
    if (aEarned === bEarned) return 0;
    return aEarned ? -1 : 1;
  });
  const savingsLabel = progress.savings.isEstimate
    ? 'Total Savings (estimated)'
    : 'Total Savings';

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <FocusVisitFromHash />
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{headerLabel}</CardTitle>
          <CardDescription>{title}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {progress.xp}
              {levelInfo.nextLevel != null
                ? ` / ${levelInfo.nextLevel.xp} XP`
                : ' XP (Max Level)'}
            </span>
            {levelInfo.nextLevel != null && (
              <span>{levelInfo.nextLevel.xp - progress.xp} XP to next level</span>
            )}
          </div>
          <Progress value={levelInfo.progressPercent} max={100} className="h-3" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your level</CardTitle>
          <CardDescription>
            Earn XP by completing visits and leaving reviews. Level names mark your progress.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {XP_LEVELS.map(({ level, minXp, name }) => {
              const unlocked = progress.xp >= minXp;
              return (
                <li
                  key={level}
                  className={`flex items-center gap-3 rounded-lg border p-4 ${
                    unlocked
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-muted bg-muted/20 opacity-75'
                  }`}
                >
                  {unlocked ? (
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary"
                      aria-hidden
                    >
                      ✓
                    </span>
                  ) : (
                    <Lock className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p
                      className={`font-medium ${unlocked ? 'text-foreground' : 'text-muted-foreground'}`}
                    >
                      Level {level} · {name}
                    </p>
                    <p className="text-xs text-muted-foreground">{minXp} XP</p>
                  </div>
                  {unlocked ? (
                    <Badge variant="default" className="shrink-0">
                      Unlocked
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0">
                      Locked
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{savingsLabel}</CardDescription>
            <CardTitle className="text-2xl">
              {progress.savings.amount == null ? '—' : `$${progress.savings.amount.toFixed(0)}`}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Places Visited</CardDescription>
            <CardTitle className="text-2xl">{progress.uniqueRestaurants}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current Streak</CardDescription>
            <CardTitle className="text-2xl">{progress.currentMonthlyStreak}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Badges & Achievements</CardTitle>
          <CardDescription>Badges earned by completing adventures</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {badges.map((b) => {
              const earned = b.earnedAt != null;
              return (
                <Card key={b.id} className={earned ? '' : 'opacity-60 grayscale'}>
                  <CardContent className="flex items-start gap-4 pt-6">
                    <span className="text-4xl" aria-hidden>
                      {b.icon}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-medium">{b.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {earned ? b.description : 'Locked'}
                      </p>
                      {earned && b.earnedAt ? (
                        <p className="text-xs text-muted-foreground">{formatEarnedOn(b.earnedAt)}</p>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {badges.length === 0 && (
            <p className="text-sm text-muted-foreground">No badges available yet.</p>
          )}
        </CardContent>
      </Card>

      {savedRecipesCard}

      <Card>
        <CardHeader>
          <CardTitle>Redemption History</CardTitle>
          <CardDescription>Restaurants you&apos;ve visited</CardDescription>
        </CardHeader>
        <CardContent>
          {!statsResult.ok ? (
            <p>{PROGRESS_UNAVAILABLE_MESSAGE}</p>
          ) : statsResult.data.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No redemptions yet. Complete a challenge to see your history here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Restaurant Name</TableHead>
                  <TableHead>Date Visited</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Memory</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statsResult.data.history.map((row) => (
                  <TableRow key={row.redemptionId}>
                    <TableCell className="font-medium">{row.restaurantName}</TableCell>
                    <TableCell>{row.date}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{visitStatusLabel(row.visitStatus)}</Badge>
                    </TableCell>
                    <TableCell>
                      <VisitNoteRead
                        redemptionId={row.redemptionId}
                        status={row.visitStatus}
                        returnTo="/journey"
                        note={row.note}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
