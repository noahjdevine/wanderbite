'use client';

import Link from 'next/link';
import QRCode from 'react-qr-code';
import { buildPartnerRedeemScanUrl } from '@/lib/partner-redeem-url';

type ShowRedemptionCodeProps = {
  code: string;
  restaurantName: string;
  restaurantSlug: string;
  discountLabel: string;
  minSpendLabel: string;
  status: 'issued' | 'verified';
  verifiedAt?: string | null;
};

export function ShowRedemptionCode({
  code,
  restaurantName,
  restaurantSlug,
  discountLabel,
  minSpendLabel,
  status,
  verifiedAt,
}: ShowRedemptionCodeProps) {
  const scanUrl = buildPartnerRedeemScanUrl(restaurantSlug, code);

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4 py-10">
      <div className="text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Show your server
        </p>
        <h1 className="mt-1 text-xl font-semibold">{restaurantName}</h1>
        <p className="mt-1 text-sm text-primary">{discountLabel}</p>
        <p className="text-xs text-muted-foreground">{minSpendLabel}</p>
      </div>

      {status === 'verified' ? (
        <div className="mt-8 rounded-xl border-2 border-green-600 bg-green-50 p-6 text-center dark:border-green-500 dark:bg-green-950/40">
          <p className="font-semibold text-green-900 dark:text-green-100">Already verified</p>
          {verifiedAt && (
            <p className="mt-1 text-sm text-green-800 dark:text-green-200">{verifiedAt}</p>
          )}
        </div>
      ) : (
        <>
          <div className="mt-8 flex justify-center rounded-xl border bg-white p-6 shadow-sm dark:bg-card">
            <QRCode value={scanUrl} size={220} level="M" />
          </div>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Server can scan this QR, or use the code below if scanning isn&apos;t available.
          </p>

          <div className="mt-6 rounded-xl border-2 border-primary/30 bg-primary/5 p-5 text-center">
            <p className="font-mono text-3xl font-bold tracking-widest text-foreground">{code}</p>
          </div>

          <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
            Your server will verify this in Wanderbite, then apply the discount on your check. POS
            integration is coming later — for now the discount is applied manually on the bill.
          </p>
        </>
      )}

      <div className="mt-10 text-center">
        <Link href="/challenges" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Back to challenges
        </Link>
      </div>
    </div>
  );
}
