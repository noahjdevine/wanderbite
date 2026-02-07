'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { verifyRedemptionTokenForPartner } from '@/app/actions/partner-verify';
import { logoutPartner } from '@/app/actions/partner-auth';

type PartnerDashboardProps = {
  restaurantName: string;
  totalRedemptionsThisMonth: number;
};

export function PartnerDashboard({
  restaurantName,
  totalRedemptionsThisMonth,
}: PartnerDashboardProps) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<
    | { success: true; email: string | null; verifiedAt: string }
    | { success: false; message: string }
    | null
  >(null);

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
      setResult({ success: false, message: 'Verification failed. Please try again.' });
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
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Partner Portal
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{restaurantName}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          Log out
        </Button>
      </header>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Total Redemptions This Month</CardTitle>
          <CardDescription>Verified customer codes at your location.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-4xl font-bold tracking-tight text-primary">
            {totalRedemptionsThisMonth}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Redeem Customer Code</CardTitle>
          <CardDescription>
            Enter the code from the customer&apos;s device to apply their $10 discount.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleVerify} className="space-y-4">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter code (e.g., WB-XXXXX)"
              className="w-full rounded-md border border-input bg-background px-4 py-3 text-base placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              disabled={isVerifying}
              autoComplete="off"
              autoFocus
            />
            <Button
              type="submit"
              className="w-full"
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
                      <span className="font-medium">Customer:</span> {result.email}
                    </p>
                  )}
                  <p>
                    <span className="font-medium">Verified at:</span> {result.verifiedAt}
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
    </>
  );
}
