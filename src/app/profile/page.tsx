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

const SAVINGS_PER_REDEMPTION_CENTS = 1000; // $10
const CURRENT_STREAK_MOCK = 1;

export default async function ProfilePage() {
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
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/profile">Profile</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-8 p-6">
        {/* Header */}
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

        {/* Achievements */}
        <Card>
          <CardHeader>
            <CardTitle>Achievements</CardTitle>
            <CardDescription>Badges earned by completing adventures</CardDescription>
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

        {/* Redemption history */}
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
