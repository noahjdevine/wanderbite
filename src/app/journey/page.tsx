import { redirect } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getUserStats } from '@/app/actions/get-user-stats';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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

export const dynamic = 'force-dynamic';

const SAVINGS_PER_REDEMPTION_CENTS = 1000; // $10
const CURRENT_STREAK_MOCK = 1;

/** Guaranteed perks by level; XP thresholds match Quarterly Giveaway (300, 600, 1000, 2000). */
const MILESTONE_PERKS = [
  { level: 1, minXp: 300, perk: 'Free App or Drink (Show screen to server)' },
  { level: 2, minXp: 600, perk: 'Free Dessert or Specialty Cocktail' },
  { level: 3, minXp: 1000, perk: 'BOGO Entree (Buy 1 Get 1 Free)' },
  { level: 4, minXp: 2000, perk: 'Legend Swag Pack' },
] as const;

/** Quarterly drawing: XP thresholds; reaching a level = entry into that tier’s drawing. */
const QUARTERLY_DRAWING_LEVELS = [
  { label: 'Level 1', amount: '$25', minXp: 300 },
  { label: 'Level 2', amount: '$50', minXp: 600 },
  { label: 'Level 3', amount: '$75', minXp: 1000 },
  { label: 'Level 4', amount: '$100', minXp: 2000 },
] as const;

const QUARTERLY_DRAWING_MAX_XP = 2000;

export default async function JourneyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('user_profiles')
    .select('id, email')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    redirect('/onboarding');
  }

  const statsResult = await getUserStats(user.id);
  if (!statsResult.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-destructive">{statsResult.error}</p>
      </main>
    );
  }

  const { data: stats } = statsResult;
  const email = (profile as { email: string | null }).email ?? 'Signed in user';
  const title = `Level ${stats.level} ${stats.currentLevelName}`;
  const totalSavingsDollars =
    (stats.redemptionCount * SAVINGS_PER_REDEMPTION_CENTS) / 100;

  return (
    <main className="min-h-screen bg-background">
      <div className="border-b py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6">
          <h1 className="text-xl font-semibold">Wanderbite</h1>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/challenges">Challenges</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/profile">Profile</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-8 p-6">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          My Journey
        </h2>

        {/* XP Meter / Level */}
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
                <span>
                  {stats.nextLevelXp - stats.xp} XP to next level
                </span>
              )}
            </div>
            <Progress
              value={stats.progressPercent}
              max={100}
              className="h-3"
            />
          </CardContent>
        </Card>

        {/* Current Level Benefits — guaranteed member perks */}
        <Card>
          <CardHeader>
            <CardTitle>Your Member Perks</CardTitle>
            <CardDescription>
              Benefits you’ve unlocked at your current level. Show your screen to the server to claim.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {MILESTONE_PERKS.map(({ level, minXp, perk }) => {
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
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary" aria-hidden>
                        ✓
                      </span>
                    ) : (
                      <Lock className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`font-medium ${unlocked ? 'text-foreground' : 'text-muted-foreground'}`}>
                        Level {level}
                      </p>
                      <p className={`text-sm ${unlocked ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {perk}
                      </p>
                    </div>
                    {unlocked ? (
                      <Badge variant="default" className="shrink-0">Unlocked</Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">Locked</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Savings</CardDescription>
              <CardTitle className="text-2xl">
                ${totalSavingsDollars.toFixed(0)}
              </CardTitle>
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

        {/* Quarterly Giveaway Progress — long-term goal; entry into drawings, not guaranteed cash */}
        <Card>
          <CardHeader>
            <CardTitle>Quarterly Giveaway Progress</CardTitle>
            <CardDescription>
              Reach XP milestones to earn entries into our quarterly gift card drawings. The more you level up, the better your chances.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {stats.xp} / {QUARTERLY_DRAWING_MAX_XP} XP
                </span>
                <span className="font-medium text-foreground">
                  {stats.xp >= QUARTERLY_DRAWING_MAX_XP
                    ? 'Max level reached!'
                    : `${QUARTERLY_DRAWING_MAX_XP - stats.xp} XP to $100 drawing`}
                </span>
              </div>
              <Progress
                value={Math.min(100, (stats.xp / QUARTERLY_DRAWING_MAX_XP) * 100)}
                max={100}
                className="h-4"
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {QUARTERLY_DRAWING_LEVELS.map((tier) => {
                const reached = stats.xp >= tier.minXp;
                return (
                  <div
                    key={tier.minXp}
                    className={`rounded-xl border-2 p-4 text-center transition-colors ${
                      reached
                        ? 'border-primary bg-primary/5'
                        : 'border-muted bg-muted/30'
                    }`}
                  >
                    <p className="text-xs font-medium text-muted-foreground">
                      {tier.label}
                    </p>
                    <p className="mt-1 text-sm font-bold text-foreground">
                      Entry into Quarterly {tier.amount} Drawing
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tier.minXp} XP
                    </p>
                    {reached ? (
                      <Badge variant="default" className="mt-2 text-xs">
                        Unlocked
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="mt-2 text-xs">
                        Locked
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Badges & Achievements */}
        <Card>
          <CardHeader>
            <CardTitle>Badges & Achievements</CardTitle>
            <CardDescription>
              Badges earned by completing adventures
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              {stats.badges.map((b) => (
                <Card
                  key={b.id}
                  className={
                    b.isEarned
                      ? ''
                      : 'opacity-60 grayscale'
                  }
                >
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
              <p className="text-sm text-muted-foreground">
                No badges available yet.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Redemption History */}
        <Card>
          <CardHeader>
            <CardTitle>Redemption History</CardTitle>
            <CardDescription>Restaurants you&apos;ve visited</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No redemptions yet. Complete a challenge to see your history
                here.
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
                      <TableCell className="font-medium">
                        {row.restaurantName}
                      </TableCell>
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
    </main>
  );
}
