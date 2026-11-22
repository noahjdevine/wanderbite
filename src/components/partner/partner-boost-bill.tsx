'use client';

import { useState, type FormEvent } from 'react';
import { confirmPartnerBillSubtotal } from '@/app/actions/partner-bill-scan';
import {
  verifyRedemptionTokenForPartner,
  type VerifyRedemptionResult,
} from '@/app/actions/partner-verify';
import {
  belowMinimumQuoteCopy,
  BOOST_BILL_BEFORE_VERIFY_MESSAGE,
  quoteStillNeedsSubtotal,
  redeemSettlementLines,
} from '@/lib/boost/savings-copy';
import { parseEligibleSubtotalDollars } from '@/lib/boost/subtotal-input';
import { formatCents } from '@/lib/offers/sealed-base';

type Verified = Extract<VerifyRedemptionResult, { success: true }>;

type PartnerBoostBillProps = {
  slug: string;
  code: string;
  sessionId: string;
  minSpendCents: number | null;
  onVerified: (result: Verified) => void;
  onCancel: () => void;
};

type QuoteView = {
  baseDiscountCents: number;
  boostDiscountCents: number;
  totalDiscountCents: number;
  eligibleSubtotalCents: number;
  belowMinimum: boolean;
};

function confirmFailure(code: string): string {
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

/**
 * Staff enter the eligible subtotal before a locked Boost code is verified.
 * The quote helper decides the cents. This screen does not reprice the offer.
 */
export function PartnerBoostBill({
  slug,
  code,
  sessionId,
  minSpendCents,
  onVerified,
  onCancel,
}: PartnerBoostBillProps) {
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<'confirm' | 'verify' | null>(null);
  const lines = quote
    ? redeemSettlementLines({
        confirmedBaseDiscountCents: quote.baseDiscountCents,
        confirmedBoostDiscountCents: quote.boostDiscountCents,
        confirmedTotalDiscountCents: quote.totalDiscountCents,
      })
    : null;
  const belowCopy = quote
    ? belowMinimumQuoteCopy({
        belowMinimum: quote.belowMinimum,
        totalDiscountCents: quote.totalDiscountCents,
        minSpendCents,
      })
    : null;

  async function confirmBill(event: FormEvent) {
    event.preventDefault();
    const cents = parseEligibleSubtotalDollars(amount);
    if (cents == null || cents <= 0) {
      setQuote(null);
      setMessage('Enter the eligible subtotal in dollars, such as 82.00.');
      return;
    }
    setPending('confirm');
    setMessage(null);
    try {
      const result = await confirmPartnerBillSubtotal({
        sessionId,
        eligibleSubtotalCents: cents,
      });
      if (!result.ok) {
        setQuote(null);
        setMessage(confirmFailure(result.code));
        return;
      }
      const next: QuoteView = {
        baseDiscountCents: result.quote.baseDiscountCents,
        boostDiscountCents: result.quote.boostDiscountCents,
        totalDiscountCents: result.quote.totalDiscountCents,
        eligibleSubtotalCents: result.quote.eligibleSubtotalCents,
        belowMinimum: result.quote.belowMinimum,
      };
      if (quoteStillNeedsSubtotal(next)) {
        setQuote(null);
        setMessage("Enter the eligible subtotal from the guest's check.");
        return;
      }
      setQuote(next);
    } catch {
      setQuote(null);
      setMessage('That amount could not be confirmed.');
    } finally {
      setPending(null);
    }
  }

  async function verifyCode() {
    if (!quote || pending) return;
    setPending('verify');
    setMessage(null);
    try {
      const result = await verifyRedemptionTokenForPartner(code);
      if (result.success) {
        onVerified(result);
        return;
      }
      if ('needsBill' in result && result.needsBill) {
        setMessage('The bill still needs a subtotal before this code can be verified.');
        return;
      }
      setMessage(result.message);
    } catch {
      setMessage('Verification failed. Please try again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="wb-partner-alert wb-partner-follow" role="status" aria-live="polite">
      <p className="wb-partner-alert-title">Boost needs the bill</p>
      <p>{BOOST_BILL_BEFORE_VERIFY_MESSAGE}</p>
      {minSpendCents != null ? <p>Offer minimum {formatCents(minSpendCents)}.</p> : null}
      <form onSubmit={confirmBill} className="wb-partner-form wb-partner-follow">
        <div>
          <label htmlFor="partner-boost-subtotal" className="wb-partner-label">
            Eligible subtotal
          </label>
          <input
            id="partner-boost-subtotal"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="82.00"
            className="wb-partner-field"
            value={amount}
            disabled={pending != null}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <button type="submit" className="wb-cta wb-partner-cta" disabled={pending != null || !amount.trim()}>
          {pending === 'confirm' ? 'Confirming…' : 'Confirm bill'}
        </button>
      </form>
      {quote && lines ? (
        <div className="wb-partner-follow" data-boost-quote="">
          {belowCopy ? <p>{belowCopy}</p> : null}
          <p>{lines.discount}</p>
          <p>{lines.boost}</p>
          <p>{lines.total}</p>
          <button
            type="button"
            className="wb-cta wb-partner-cta wb-partner-follow"
            disabled={pending != null}
            onClick={() => {
              void verifyCode();
            }}
          >
            {pending === 'verify' ? 'Verifying…' : quote.belowMinimum ? 'Verify visit' : 'Verify code'}
          </button>
        </div>
      ) : null}
      {message ? (
        <p className="wb-partner-follow" role="alert">
          {message}
        </p>
      ) : null}
      <p className="wb-partner-section-copy wb-partner-follow">
        <a href={`/partner/${slug}/arrival`}>Open arrival check-in</a>
        {' '}and come back here to verify this code.
      </p>
      <button type="button" className="wb-partner-text-button" onClick={onCancel} disabled={pending != null}>
        Enter a different code
      </button>
    </div>
  );
}
