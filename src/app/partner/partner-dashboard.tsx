'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { verifyRedemptionTokenForPartner } from '@/app/actions/partner-verify';
import { formatCents } from '@/lib/offers/sealed-base';
import { toast } from 'sonner';
import { logoutPartner } from '@/app/actions/partner-auth';
import type { PartnerAnalyticsResult } from '@/app/actions/partner-auth';

type PartnerDashboardProps = {
  restaurantName: string;
  restaurantSlug: string;
  analytics: PartnerAnalyticsResult | null;
};

const CODE_HINT_ID = 'partner-dashboard-code-hint';
const CODE_ERROR_ID = 'partner-dashboard-code-error';

export function PartnerDashboard({
  restaurantName,
  restaurantSlug,
  analytics,
}: PartnerDashboardProps) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<
    | {
        success: true;
        email: string | null;
        verifiedAt: string;
        hideDiscountAmount: boolean;
        sealedDiscountCents: number | null;
        sealedMinSpendCents: number | null;
      }
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
  const codeError = result && !result.success ? result : null;

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
          hideDiscountAmount: res.hideDiscountAmount,
          sealedDiscountCents: res.sealedDiscountCents,
          sealedMinSpendCents: res.sealedMinSpendCents,
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
    const result = await logoutPartner();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <header className="wb-partner-page-head">
        <div>
          <h1 className="wb-partner-title">Partner Portal</h1>
          <p className="wb-partner-name">{restaurantName}</p>
        </div>
        <div className="wb-partner-page-actions">
          <Link href={`/partner/${restaurantSlug}/redeem`} className="wb-cta wb-partner-cta">
            Redeem mode
          </Link>
          <button type="button" className="wb-cta-secondary wb-cta-secondary-cream wb-partner-secondary" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <section className="wb-partner-card">
        <form onSubmit={handleVerify} className="wb-partner-verify">
          <div>
            <label htmlFor="partner-dashboard-code" className="wb-partner-section-title">
              Redeem Customer Code
            </label>
            <p id={CODE_HINT_ID} className="wb-partner-section-copy">
              Enter the code from the customer&apos;s device.
            </p>
          </div>
          <div className="wb-partner-verify-row">
            <input
              id="partner-dashboard-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter code (e.g., WB-XXXXX)"
              className="wb-partner-code"
              disabled={isVerifying}
              autoComplete="off"
              autoFocus
              aria-invalid={codeError ? true : undefined}
              aria-describedby={codeError ? `${CODE_HINT_ID} ${CODE_ERROR_ID}` : CODE_HINT_ID}
            />
            <button
              type="submit"
              className="wb-cta wb-partner-cta"
              disabled={isVerifying || !code.trim()}
            >
              {isVerifying ? 'Verifying…' : 'Redeem Code'}
            </button>
          </div>
        </form>

        {result?.success && (
          <div className="wb-partner-alert wb-partner-alert-ok wb-partner-follow" role="alert" aria-live="assertive">
            <p className="wb-partner-alert-title">
              {result.sealedDiscountCents != null && result.sealedMinSpendCents != null
                ? `Valid — ${formatCents(result.sealedDiscountCents)} off ${formatCents(result.sealedMinSpendCents)}`
                : result.hideDiscountAmount
                  ? 'Valid'
                  : 'Valid — $10 discount applied'}
            </p>
            <div>
              {result.email && (
                <p>
                  <span className="wb-partner-alert-title">Customer:</span>{' '}
                  {result.email}
                </p>
              )}
              <p>
                <span className="wb-partner-alert-title">Verified at:</span>{' '}
                {result.verifiedAt}
              </p>
            </div>
          </div>
        )}

        {codeError && (
          <div
            id={CODE_ERROR_ID}
            className="wb-partner-alert wb-partner-alert-error wb-partner-follow"
            role="alert"
            aria-live="assertive"
          >
            <p className="wb-partner-alert-title">Invalid or already used</p>
            <p>{codeError.message}</p>
          </div>
        )}
      </section>

      {analytics && !analytics.ok && (
        <div className="wb-partner-alert wb-partner-alert-error wb-partner-follow-lg" role="alert" aria-live="assertive">
          <p className="wb-partner-alert-title">Analytics unavailable</p>
          <p>{analytics.error}</p>
        </div>
      )}

      {hasAnalytics && (
        <div className="wb-partner-stack wb-partner-follow-lg">
          <div className="wb-partner-kpis">
            <section className="wb-partner-card">
              <p className="wb-partner-kpi-label">Total Redemptions (All Time)</p>
              <p className="wb-partner-kpi-value">{totalAllTime}</p>
            </section>
            <section className="wb-partner-card">
              <p className="wb-partner-kpi-label">Redemptions (This Month)</p>
              <p className="wb-partner-kpi-value">{totalThisMonth}</p>
            </section>
            <section className="wb-partner-card">
              <p className="wb-partner-kpi-label">Estimated Revenue Generated</p>
              <p className="wb-partner-kpi-value wb-partner-kpi-value-ok">{revenueFormatted}</p>
              <p className="wb-partner-kpi-note">
                Estimated based on avg. check size of $45.
              </p>
            </section>
          </div>

          <section className="wb-partner-card">
            <p className="wb-partner-section-title">Performance History</p>
            <p className="wb-partner-section-copy">
              Verified redemptions over the last 6 months
            </p>
            {historicalVolume.length === 0 ? (
              <p className="wb-partner-section-copy">
                No redemptions in this period yet.
              </p>
            ) : (
              <ul className="wb-partner-meters">
                {historicalVolume.map(({ monthLabel, count }) => (
                  <li key={monthLabel} className="wb-partner-meter-row">
                    <div className="wb-partner-meter-label">
                      <span>{monthLabel}</span>
                      <span>{count}</span>
                    </div>
                    <div
                      className="wb-partner-meter"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={maxVolume}
                      aria-valuenow={count}
                      aria-label={`${monthLabel} ${count}`}
                    >
                      <span style={{ width: `${maxVolume ? (count / maxVolume) * 100 : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="wb-partner-card">
            <p className="wb-partner-section-title">Recent Guests</p>
            <p className="wb-partner-section-copy">
              Latest verified redemptions at your location
            </p>
            {recentCustomers.length === 0 ? (
              <p className="wb-partner-section-copy">
                No verified redemptions yet.
              </p>
            ) : (
              <div className="wb-partner-scroll wb-partner-follow">
                <table className="wb-partner-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Guest Email</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentCustomers.map((guest, i) => (
                      <tr key={i}>
                        <td>{guest.verifiedAt}</td>
                        <td>{guest.emailMasked}</td>
                        <td>
                          <span className="wb-partner-badge">Verified</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
