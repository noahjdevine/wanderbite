import { redirect } from 'next/navigation';
import { format } from 'date-fns';
import { lowestSealedBase } from '@/lib/offers/sealed-base';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type { Json } from '@/types/database.types';
import { getUserStats } from '@/app/actions/get-user-stats';
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

const SAVINGS_PER_REDEMPTION_CENTS = 1000;
const CURRENT_STREAK_MOCK = 1;

const LEVEL_TITLES = [
  { level: 1, minXp: 300, title: 'The Explorer' },
  { level: 2, minXp: 1000, title: 'The Tastemaker' },
  { level: 3, minXp: 1500, title: 'The Connoisseur' },
  { level: 4, minXp: 2500, title: 'The Local Legend' },
] as const;

type JourneyContentProps = {
  userId: string;
};

export async function JourneyContent({ userId }: JourneyContentProps) {
  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('user_profiles')
    .select('id, email')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) {
    redirect('/onboarding');
  }

  const statsResult = await getUserStats();
  if (!statsResult.ok) {
    return <p className="text-destructive">{statsResult.error}</p>;
  }

  const { data: stats } = statsResult;
  const email = (profile as { email: string | null }).email ?? 'Signed in user';
  const title = `Level ${stats.level} ${stats.currentLevelName}`;
  const { data: verifiedRows } = await admin
    .from('redemptions')
    .select('challenge_item_id')
    .eq('user_id', userId)
    .eq('status', 'verified');
  const verified = (verifiedRows ?? []) as { challenge_item_id: string | null }[];
  const itemIds = verified.flatMap((row) => (row.challenge_item_id ? [row.challenge_item_id] : []));
  const sealedCentsByItem = new Map<string, number>();
  if (itemIds.length > 0) {
    const { data: items } = await admin
      .from('challenge_items')
      .select('id, offer_version_id')
      .in('id', itemIds);
    const rows = (items ?? []) as { id: string; offer_version_id: string | null }[];
    const versionIds = rows.flatMap((item) => (item.offer_version_id ? [item.offer_version_id] : []));
    const centsByVersion = new Map<string, number>();
    if (versionIds.length > 0) {
      const { data: versions } = await admin
        .from('offer_versions')
        .select('id, tiers')
        .in('id', versionIds);
      for (const version of versions ?? []) {
        const base = lowestSealedBase((version as { tiers: Json }).tiers);
        if (base) centsByVersion.set(version.id, base.discount_amount_cents);
      }
    }
    for (const item of rows) {
      if (!item.offer_version_id) continue;
      const cents = centsByVersion.get(item.offer_version_id);
      if (cents != null) sealedCentsByItem.set(item.id, cents);
    }
  }
  const totalSavingsCents = verified.reduce((sum, row) => {
    if (row.challenge_item_id && sealedCentsByItem.has(row.challenge_item_id)) {
      return sum + (sealedCentsByItem.get(row.challenge_item_id) ?? 0);
    }
    return sum + SAVINGS_PER_REDEMPTION_CENTS;
  }, 0);
  const totalSavingsDollars = totalSavingsCents / 100;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{email}</CardTitle>
          <CardDescription>{title}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {stats.xp}
              {stats.nextLevelXp != null
                ? ` / ${stats.nextLevelXp} XP`
                : ' XP (Max Level)'}
            </span>
            {stats.nextLevelXp != null && (
              <span>{stats.nextLevelXp - stats.xp} XP to next level</span>
            )}
          </div>
          <Progress value={stats.progressPercent} max={100} className="h-3" />
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
            {LEVEL_TITLES.map(({ level, minXp, title }) => {
              const unlocked = stats.xp >= minXp;
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
                      Level {level} · {title}
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
            <CardDescription>Total Savings</CardDescription>
            <CardTitle className="text-2xl">${totalSavingsDollars.toFixed(0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Places Visited</CardDescription>
            <CardTitle className="text-2xl">{stats.redemptionCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current Streak</CardDescription>
            <CardTitle className="text-2xl">{CURRENT_STREAK_MOCK}</CardTitle>
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
            {stats.badges.map((b) => (
              <Card key={b.id} className={b.isEarned ? '' : 'opacity-60 grayscale'}>
                <CardContent className="flex items-start gap-4 pt-6">
                  <span className="text-4xl" aria-hidden>
                    {b.icon}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">{b.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {b.isEarned ? b.description : 'Locked'}
                    </p>
                    {b.isEarned && b.awardedAt && (
                      <p className="text-xs text-muted-foreground">
                        Earned on {format(new Date(b.awardedAt), 'PP')}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {stats.badges.length === 0 && (
            <p className="text-sm text-muted-foreground">No badges available yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Redemption History</CardTitle>
          <CardDescription>Restaurants you&apos;ve visited</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.history.length === 0 ? (
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.history.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.restaurantName}</TableCell>
                    <TableCell>{row.date}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">Verified</Badge>
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
