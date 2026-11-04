import { Flame } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { PROGRESS_UNAVAILABLE_MESSAGE } from '@/lib/progress/rules';

type StreakPanelProps = {
  streak: { currentStreak: number; longestStreak: number; totalMonthsActive: number };
  progressUnavailable: boolean;
  earnedBadges: { id: string; name: string; earnedOn: string | null }[];
  showFirstBiteLocked: boolean;
  nextBadge: { name: string; current: number; target: number } | null;
};

export function StreakPanel({
  streak,
  progressUnavailable,
  earnedBadges,
  showFirstBiteLocked,
  nextBadge,
}: StreakPanelProps) {
  const streakLabel = streak.currentStreak === 1 ? '1 month streak' : `${streak.currentStreak} month streak`;

  return (
    <Card className="overflow-hidden border-orange-200/80 bg-gradient-to-br from-orange-50/90 to-background dark:border-orange-900/40 dark:from-orange-950/25">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#E85D26]/15 text-[#E85D26]">
              <Flame className="size-6" aria-hidden />
            </div>
            <div>
              <CardTitle className="text-lg">Dining streak</CardTitle>
              <CardDescription>
                {progressUnavailable ? (
                  <span className="text-muted-foreground">{PROGRESS_UNAVAILABLE_MESSAGE}</span>
                ) : streak.currentStreak > 0 ? (
                  <span className="font-medium text-foreground">{streakLabel}</span>
                ) : (
                  <span className="text-muted-foreground">Start your streak this month!</span>
                )}
              </CardDescription>
            </div>
          </div>
          {progressUnavailable || (earnedBadges.length === 0 && !showFirstBiteLocked) ? null : (
            <div className="flex flex-wrap justify-end gap-2">
              {earnedBadges.map((badge) => (
                <Badge
                  key={badge.id}
                  variant="secondary"
                  className="shrink-0 border-[#E85D26]/30 bg-[#E85D26]/10 text-[#E85D26] dark:bg-[#E85D26]/20"
                >
                  {badge.name}
                  {badge.earnedOn ? ` · ${badge.earnedOn}` : ''}
                </Badge>
              ))}
              {showFirstBiteLocked ? (
                <Badge variant="outline" className="shrink-0 text-muted-foreground">
                  First Bite locked
                </Badge>
              ) : null}
            </div>
          )}
        </div>
      </CardHeader>
      {progressUnavailable ? null : (
        <CardContent className="space-y-3 pt-0">
          <p className="text-sm text-muted-foreground">
            Longest streak:{' '}
            <span className="font-medium text-foreground">
              {streak.longestStreak} {streak.longestStreak === 1 ? 'month' : 'months'}
            </span>
            {streak.totalMonthsActive > 0 && (
              <>
                {' '}
                · {streak.totalMonthsActive} distinct {streak.totalMonthsActive === 1 ? 'month' : 'months'} with a
                visit
              </>
            )}
          </p>
          {nextBadge != null && nextBadge.target > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Progress to {nextBadge.name}</span>
                <span>
                  {nextBadge.current} / {nextBadge.target}
                </span>
              </div>
              <Progress
                value={Math.min(100, Math.round((nextBadge.current / nextBadge.target) * 100))}
                max={100}
                className="h-1.5 bg-muted"
              />
            </div>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}
