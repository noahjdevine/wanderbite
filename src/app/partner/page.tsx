'use client';

import { useState } from 'react';
import { verifyRedemptionToken } from '@/app/actions/partner-verify';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function PartnerPage() {
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<
    | { success: true; email: string | null; restaurantName: string; verifiedAt: string }
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
      const res = await verifyRedemptionToken(trimmed);
      if (res.success) {
        setResult({
          success: true,
          email: res.redemptionDetails.email,
          restaurantName: res.redemptionDetails.restaurantName,
          verifiedAt: res.redemptionDetails.verifiedAt,
        });
      } else {
        setResult({ success: false, message: res.message });
      }
    } catch {
      setResult({ success: false, message: 'Verification failed. Please try again.' });
    } finally {
      setIsVerifying(false);
    }
  }

  function handleScanAnother() {
    setCode('');
    setResult(null);
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-md px-6 py-12">
        <header className="mb-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Wanderbite Partner Portal
          </h1>
        </header>

        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">
              Enter the voucher code from the customer&apos;s device.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleVerify} className="space-y-4">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter Voucher Code (e.g., WB-XXXX)"
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
                {isVerifying ? 'Verifying…' : 'Verify Code'}
              </Button>
            </form>

            {result?.success && (
              <div className="space-y-3">
                <Alert
                  className="border-green-600 bg-green-50 text-green-900 dark:border-green-500 dark:bg-green-950/30 dark:text-green-100"
                  variant="default"
                >
                  <AlertTitle>✅ Valid! $10 Discount Applied.</AlertTitle>
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
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleScanAnother}
                >
                  Scan Another
                </Button>
              </div>
            )}

            {result && !result.success && (
              <Alert variant="destructive">
                <AlertTitle>❌ Invalid or Already Used.</AlertTitle>
                <AlertDescription>{result.message}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
