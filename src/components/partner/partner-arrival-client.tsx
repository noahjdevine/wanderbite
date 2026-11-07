'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBoostArrivalSession } from '@/app/actions/partner-boost-arrival';
import {
  confirmPartnerBillSubtotal,
  findPartnerArrivalItems,
  uploadPartnerBillReceipt,
  type PartnerArrivalItem,
  type PartnerBillUploadResult,
} from '@/app/actions/partner-bill-scan';
import { logoutPartner } from '@/app/actions/partner-auth';
import { formatCents } from '@/lib/offers/sealed-base';
import { RECEIPT_MAX_BYTES } from '@/lib/boost/receipt-limits';
import { toast } from 'sonner';

type PartnerArrivalClientProps = {
  restaurantName: string;
  slug: string;
};

type ScanView = Extract<PartnerBillUploadResult, { ok: true }>;

type QuoteView = {
  totalDiscountCents: number;
  belowMinimum: boolean;
  eligibleSubtotalCents: number;
};

const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

function arrivalIdempotencyKey(challengeItemId: string): string {
  return `e07-arrival:${challengeItemId}`;
}

function parseDollarInput(raw: string): number | null {
  const text = raw.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  if (!whole || whole.length > 7) return null;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

function checkInMessage(code: string): string {
  switch (code) {
    case 'not_assigned':
      return 'That challenge is not ready for check-in.';
    case 'session_open':
      return 'This visit already has a check-in. Search again.';
    case 'past_deadline':
      return 'The visit window has closed.';
    case 'forbidden':
      return 'Sign in as this restaurant to check a guest in.';
    default:
      return 'Check-in did not open.';
  }
}

function uploadMessage(code: string): string {
  switch (code) {
    case 'unsupported_type':
    case 'missing_file':
      return 'Use a JPEG, PNG, WebP, HEIC, or HEIF image.';
    case 'too_large':
      return 'That image is over 10 MB.';
    case 'no_open_session':
      return 'Check the guest in before uploading a receipt.';
    case 'forbidden':
      return 'Sign in as this restaurant to upload a receipt.';
    default:
      return 'The receipt could not be saved. Try again.';
  }
}

function confirmMessage(code: string): string {
  switch (code) {
    case 'invalid_subtotal':
      return 'Enter the eligible subtotal in dollars, such as 82.00.';
    case 'past_deadline':
      return 'The visit window has closed.';
    case 'session_closed':
      return 'This check-in is closed.';
    default:
      return 'That amount could not be confirmed.';
  }
}

export function PartnerArrivalClient({ restaurantName, slug }: PartnerArrivalClientProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [items, setItems] = useState<PartnerArrivalItem[] | null>(null);
  const [sessions, setSessions] = useState<Record<string, string>>({});
  const [scans, setScans] = useState<Record<string, ScanView>>({});
  const [quotes, setQuotes] = useState<Record<string, QuoteView>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function handleLogout() {
    const result = await logoutPartner();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  async function handleFind(event: FormEvent) {
    event.preventDefault();
    setPending('find');
    setMessage(null);
    try {
      const result = await findPartnerArrivalItems({ email });
      if (!result.ok) {
        setItems(null);
        setMessage(result.code === 'invalid_email' ? 'Enter the guest email.' : 'Search did not finish. Try again.');
        return;
      }
      setItems(result.items);
      const next: Record<string, string> = {};
      for (const item of result.items) {
        if (item.openSessionId) next[item.challengeItemId] = item.openSessionId;
      }
      setSessions(next);
    } catch {
      setMessage('Search did not finish. Try again.');
    } finally {
      setPending(null);
    }
  }

  async function handleCheckIn(item: PartnerArrivalItem) {
    setPending(item.challengeItemId);
    setMessage(null);
    try {
      const result = await createBoostArrivalSession({
        challengeItemId: item.challengeItemId,
        idempotencyKey: arrivalIdempotencyKey(item.challengeItemId),
        eligibleSubtotalCents: 0,
      });
      if (!result.ok) {
        setMessage(checkInMessage(result.code));
        return;
      }
      setSessions((current) => ({ ...current, [item.challengeItemId]: result.session.id }));
    } catch {
      setMessage('Check-in did not open.');
    } finally {
      setPending(null);
    }
  }

  async function handleUpload(item: PartnerArrivalItem, sessionId: string) {
    const file = files[item.challengeItemId];
    if (!file) {
      setMessage('Choose a receipt image.');
      return;
    }
    if (file.size > RECEIPT_MAX_BYTES) {
      setMessage('That image is over 10 MB.');
      return;
    }
    setPending(`upload:${item.challengeItemId}`);
    setMessage(null);
    try {
      const body = new FormData();
      body.set('sessionId', sessionId);
      body.set('receipt', file);
      const result = await uploadPartnerBillReceipt(body);
      if (!result.ok) {
        setMessage(uploadMessage(result.code));
        return;
      }
      setScans((current) => ({ ...current, [sessionId]: result }));
      setQuotes((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
    } catch {
      setMessage('The receipt could not be saved. Try again.');
    } finally {
      setPending(null);
    }
  }

  async function handleConfirm(sessionId: string, cents: number, proposalId: string | null) {
    setPending(`confirm:${sessionId}`);
    setMessage(null);
    try {
      const result = await confirmPartnerBillSubtotal({
        sessionId,
        eligibleSubtotalCents: cents,
        proposalId,
      });
      if (!result.ok) {
        setMessage(confirmMessage(result.code));
        return;
      }
      setQuotes((current) => ({
        ...current,
        [sessionId]: {
          totalDiscountCents: result.quote.totalDiscountCents,
          belowMinimum: result.quote.belowMinimum,
          eligibleSubtotalCents: result.quote.eligibleSubtotalCents,
        },
      }));
    } catch {
      setMessage('That amount could not be confirmed.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="wb-partner-redeem">
      <div className="wb-partner-redeem-head">
        <p className="wb-partner-eyebrow">Arrival check-in</p>
        <h1 className="wb-partner-title wb-partner-follow">{restaurantName}</h1>
        <p className="wb-partner-redeem-copy">
          Find the guest&apos;s in-progress challenge at this restaurant. Check-in locks the visit.
          It does not apply a discount. Confirm the bill after that.
        </p>
      </div>

      <form onSubmit={handleFind} className="wb-partner-form">
        <div>
          <label htmlFor="partner-arrival-email" className="wb-partner-label">
            Guest email
          </label>
          <input
            id="partner-arrival-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
            className="wb-partner-field"
            disabled={pending === 'find'}
          />
        </div>
        <button type="submit" className="wb-cta wb-partner-cta wb-partner-cta-block" disabled={pending === 'find' || !email.trim()}>
          {pending === 'find' ? 'Searching…' : 'Find challenge'}
        </button>
      </form>

      {message && (
        <div className="wb-partner-alert wb-partner-alert-error wb-partner-follow" role="alert" aria-live="assertive">
          <p>{message}</p>
        </div>
      )}

      {items && items.length === 0 && (
        <p className="wb-partner-section-copy wb-partner-follow" role="status">
          No in-progress challenge at this restaurant.
        </p>
      )}

      <div className="wb-partner-stack">
        {items?.map((item) => {
          const sessionId = sessions[item.challengeItemId] ?? null;
          const scan = sessionId ? scans[sessionId] : undefined;
          const quote = sessionId ? quotes[sessionId] : undefined;
          const busy = pending === item.challengeItemId || pending === `upload:${item.challengeItemId}`;
          return (
            <section key={item.challengeItemId} className="wb-partner-card wb-partner-follow" aria-labelledby={`arrival-${item.challengeItemId}`}>
              <h2 id={`arrival-${item.challengeItemId}`} className="wb-partner-section-title">
                {item.memberName}
              </h2>
              <p className="wb-partner-section-copy">In progress at this restaurant.</p>

              {!sessionId && (
                <>
                  <p className="wb-partner-section-copy">
                    Check-in uses a $0 subtotal so the visit locks now. The discount stays $0 until you confirm the bill.
                  </p>
                  <button
                    type="button"
                    className="wb-cta wb-partner-cta wb-partner-follow"
                    disabled={busy}
                    onClick={() => handleCheckIn(item)}
                  >
                    {pending === item.challengeItemId ? 'Checking in…' : 'Check in'}
                  </button>
                </>
              )}

              {sessionId && (
                <div className="wb-partner-follow">
                  <p className="wb-partner-section-copy">Checked in. A receipt scan does not apply a discount.</p>
                  <form
                    className="wb-partner-form wb-partner-follow"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleUpload(item, sessionId);
                    }}
                  >
                    <div>
                      <label htmlFor={`receipt-${item.challengeItemId}`} className="wb-partner-label">
                        Receipt image
                      </label>
                      <input
                        id={`receipt-${item.challengeItemId}`}
                        type="file"
                        accept={RECEIPT_ACCEPT}
                        className="wb-partner-field"
                        disabled={busy}
                        onChange={(event) => {
                          const next = event.target.files?.[0] ?? null;
                          setFiles((current) => ({ ...current, [item.challengeItemId]: next }));
                        }}
                      />
                      <p className="wb-partner-section-copy">JPEG, PNG, WebP, HEIC, or HEIF. 10 MB maximum. One image.</p>
                    </div>
                    <button type="submit" className="wb-cta wb-partner-cta" disabled={busy || !files[item.challengeItemId]}>
                      {pending === `upload:${item.challengeItemId}` ? 'Uploading…' : 'Upload receipt'}
                    </button>
                  </form>

                  {scan && (
                    <div className="wb-partner-alert wb-partner-follow" role="status" aria-live="polite">
                      {scan.grossCents != null && <p>Parsed total {formatCents(scan.grossCents)}</p>}
                      {scan.proposedEligibleSubtotalCents != null && (
                        <p>Eligible subtotal {formatCents(scan.proposedEligibleSubtotalCents)}</p>
                      )}
                      <p>Confidence {scan.confidence == null ? 'unknown' : scan.confidence.toFixed(2)}</p>
                      {scan.requiresManualEntry && (
                        <p>Confidence is under 0.8, or the reader did not return a usable total. Enter the eligible subtotal.</p>
                      )}
                    </div>
                  )}

                  {scan && !scan.requiresManualEntry && scan.proposedEligibleSubtotalCents != null && (
                    <button
                      type="button"
                      className="wb-cta wb-partner-cta wb-partner-follow"
                      disabled={pending === `confirm:${sessionId}`}
                      onClick={() => {
                        if (scan.proposedEligibleSubtotalCents == null) return;
                        void handleConfirm(sessionId, scan.proposedEligibleSubtotalCents, scan.proposalId);
                      }}
                    >
                      Confirm {formatCents(scan.proposedEligibleSubtotalCents)}
                    </button>
                  )}

                  <form
                    className="wb-partner-form wb-partner-follow"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const cents = parseDollarInput(amounts[sessionId] ?? '');
                      if (cents == null) {
                        setMessage('Enter the eligible subtotal in dollars, such as 82.00.');
                        return;
                      }
                      void handleConfirm(sessionId, cents, scan?.proposalId ?? null);
                    }}
                  >
                    <div>
                      <label htmlFor={`amount-${item.challengeItemId}`} className="wb-partner-label">
                        Eligible subtotal
                      </label>
                      <input
                        id={`amount-${item.challengeItemId}`}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="82.00"
                        className="wb-partner-field"
                        value={amounts[sessionId] ?? ''}
                        onChange={(event) =>
                          setAmounts((current) => ({ ...current, [sessionId]: event.target.value }))
                        }
                      />
                    </div>
                    <button type="submit" className="wb-cta-secondary wb-cta-secondary-cream wb-partner-secondary" disabled={pending === `confirm:${sessionId}`}>
                      {pending === `confirm:${sessionId}` ? 'Confirming…' : 'Confirm entered amount'}
                    </button>
                  </form>

                  {quote && (
                    <div className="wb-partner-alert wb-partner-alert-ok wb-partner-follow" role="status" aria-live="polite">
                      <p className="wb-partner-alert-title">
                        {quote.belowMinimum
                          ? `Confirmed ${formatCents(quote.eligibleSubtotalCents)}. This offer's minimum was not met, so the discount is $0.`
                          : `Confirmed ${formatCents(quote.eligibleSubtotalCents)}. Discount on this quote: ${formatCents(quote.totalDiscountCents)}.`}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="wb-partner-redeem-links">
        <Link href={`/partner/${slug}`}>Full dashboard</Link>
        <button type="button" onClick={handleLogout} className="wb-partner-text-button">
          Log out
        </button>
      </div>
    </div>
  );
}
