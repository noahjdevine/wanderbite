'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { verifyRedemptionTokenForPartner } from '@/app/actions/partner-verify';
import { logoutPartner } from '@/app/actions/partner-auth';
import type { PartnerAnalyticsResult } from '@/app/actions/partner-auth';

type PartnerDashboardProps = {
  restaurantName: string;
  analytics: PartnerAnalyticsResult | null;
};

export function PartnerDashboard({
  restaurantName,
  analytics,
}: PartnerDashboardProps) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<
    | { success: true; email: string | null; verifiedAt: string }
    | { success: false; message: string }
    | null
  >(null);

  const hasAnalytics = analytics?.ok === true;
  const totalAllTime = hasAnalytics ? analytics.totalRedemptionsAllTime : 0;
  const totalThisMonth = hasAnalytics ? analytics.totalRedemptionsThisMonth : 0;
  const revenueFormatted = hasAnalytics ? analytics.revenueFormatted : '$0';
  const historicalVolume = hasAnalytics ? analytics.historicalVolume : [];
  const recentCustomers = hasAnalytics ? analytics.recentCustomers : [];
  const maxVolume = Math.max(
    1,
    ...historicalVolume.map((h) => h.count)
  );

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setIsVerifying(true);
    setResult(null);
    try {
      const res = await verifyRedemptionTokenForPartner(trimmed);
      if (res.success) {
        setResult({
          success: true,
          email: res.redemptionDetails.email,
          verifiedAt: res.redemptionDetails.verifiedAt,
        });
        setCode('');
        router.refresh();
      } else {
        setResult({ success: false, message: res.message });
      }
    } catch {
      setResult({
        success: false,
        message: 'Verification failed. Please try again.',
      });
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleLogout() {
    await logoutPartner();
    router.refresh();
  }

  return (
    <>
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Partner Portal
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {restaurantName}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          Log out
        </Button>
      </header>

      {/* Redeem Code — prominent at top */}
      <Card className="mb-8">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Redeem Customer Code</CardTitle>
          <CardDescription>
            Enter the code from the customer&apos;s device to apply their $10
            discount.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleVerify} className="flex gap-3">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter code (e.g., WB-XXXXX)"
              className="flex-1 rounded-md border border-input bg-background px-4 py-3 text-base placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              disabled={isVerifying}
              autoComplete="off"
              autoFocus
            />
            <Button
              type="submit"
              className="shrink-0"
              disabled={isVerifying || !code.trim()}
            >
              {isVerifying ? 'Verifying…' : 'Redeem Code'}
            </Button>
          </form>

          {result?.success && (
            <Alert
              className="border-green-600 bg-green-50 text-green-900 dark:border-green-500 dark:bg-green-950/30 dark:text-green-100"
              variant="default"
            >
              <AlertTitle>Valid — $10 discount applied</AlertTitle>
              <AlertDescription>
                <div className="mt-2 space-y-1 text-sm">
                  {result.email && (
                    <p>
                      <span className="font-medium">Customer:</span>{' '}
                      {result.email}
                    </p>
                  )}
                  <p>
                    <span className="font-medium">Verified at:</span>{' '}
                    {result.verifiedAt}
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {result && !result.success && (
            <Alert variant="destructive">
              <AlertTitle>Invalid or already used</AlertTitle>
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Analytics section — only when we have data */}
      {analytics && !analytics.ok && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Analytics unavailable</AlertTitle>
          <AlertDescription>{analytics.error}</AlertDescription>
        </Alert>
      )}

      {hasAnalytics && (
        <div className="space-y-8">
          {/* Top row: 3 KPI cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total Redemptions (All Time)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold tracking-tight">
                  {totalAllTime}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Redemptions (This Month)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold tracking-tight">
                  {totalThisMonth}
                </p>
              </CardContent>
            </Card>
            <Card className="border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Estimated Revenue Generated
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold tracking-tight text-green-700 dark:text-green-400">
                  {revenueFormatted}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Estimated based on avg. check size of $45.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Performance History — last 6 months */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Performance History</CardTitle>
              <CardDescription>
                Verified redemptions over the last 6 months
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {historicalVolume.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No redemptions in this period yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {historicalVolume.map(({ monthLabel, count }) => (
                    <li key={monthLabel} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{monthLabel}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </div>
                      <Progress value={count} max={maxVolume} className="h-2" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Recent Guests */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Recent Guests</CardTitle>
              <CardDescription>
                Latest verified redemptions at your location
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentCustomers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No verified redemptions yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Guest Email</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentCustomers.map((guest, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">
                          {guest.verifiedAt}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {guest.emailMasked}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">
                            Verified
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
