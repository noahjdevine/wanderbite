'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DRAWING_FULFILLMENT_NOTE_MAX,
  DRAWING_FULFILLMENT_SUCCESS,
  FULFILLMENT_NOTE_MESSAGE,
  fulfillmentOfferStatus,
  type DrawingFulfillmentOffer,
  type DrawingFulfillmentOfferKind,
} from '@/lib/drawings/fulfillment-admin-actions';
import { createDrawingFulfillmentsAction, transitionDrawingFulfillmentAction } from './actions';

/**
 * Second click confirms. The first click does not call the server action.
 * A cost above the allowance shows the server warning, and a further click
 * sends the same dollars with confirmOverAllowance.
 */
export function DrawingFulfillmentCreate({
  selectionId,
  offer,
}: {
  selectionId: string;
  offer: DrawingFulfillmentOffer;
}) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const result = await createDrawingFulfillmentsAction(selectionId);
      setConfirming(false);
      if (result.ok) {
        setMessage(DRAWING_FULFILLMENT_SUCCESS.create);
        router.refresh();
      } else {
        setError(result.message);
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm" role="status">
          {message}
        </p>
      ) : null}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={() => void confirm()}>
            {offer.confirmLabel}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setConfirming(true);
            setMessage(null);
            setError(null);
          }}
        >
          {offer.label}
        </Button>
      )}
    </div>
  );
}

function NoteField({ id, note, onNote }: { id: string; note: string; onNote: (value: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium" htmlFor={id}>
        Note, optional
      </label>
      <textarea
        id={id}
        className="min-h-16 w-full rounded-md border bg-background px-3 py-2 text-sm"
        maxLength={DRAWING_FULFILLMENT_NOTE_MAX}
        value={note}
        onChange={(event) => onNote(event.target.value)}
      />
      <p className="text-sm text-muted-foreground">
        {note.length}/{DRAWING_FULFILLMENT_NOTE_MAX}
      </p>
    </div>
  );
}

export function DrawingWinnerFulfillmentActions({
  fulfillmentId,
  offers,
}: {
  fulfillmentId: string;
  offers: DrawingFulfillmentOffer[];
}) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState<Exclude<DrawingFulfillmentOfferKind, 'create'> | null>(null);
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const winnerOffers = offers.filter(
    (offer): offer is DrawingFulfillmentOffer & { kind: 'ready' | 'fulfill' | 'forfeit' } => offer.kind !== 'create',
  );

  async function submit(kind: 'ready' | 'fulfill' | 'forfeit', confirmOverAllowance: boolean) {
    if (busy.current) return;
    if (note.length > DRAWING_FULFILLMENT_NOTE_MAX) {
      setError(FULFILLMENT_NOTE_MESSAGE);
      setWarning(null);
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const result = await transitionDrawingFulfillmentAction({
        fulfillmentId,
        toStatus: fulfillmentOfferStatus(kind),
        note,
        ...(kind === 'fulfill' ? { actualCostDollars: cost, confirmOverAllowance } : {}),
      });
      if (result.ok) {
        setWarning(null);
        setConfirming(null);
        setMessage(DRAWING_FULFILLMENT_SUCCESS[kind]);
        router.refresh();
        return;
      }
      if (result.error === 'over_allowance_confirm' && kind === 'fulfill') {
        setWarning(result.message);
        return;
      }
      setWarning(null);
      setError(result.message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (winnerOffers.length === 0) return null;

  return (
    <div className="space-y-2">
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm" role="status">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {winnerOffers.map((action) =>
          confirming === action.kind ? (
            <div key={action.kind} className="w-full max-w-md space-y-2">
              {action.kind === 'fulfill' ? (
                <div className="space-y-1">
                  <label className="block text-sm font-medium" htmlFor={`cost-${fulfillmentId}`}>
                    Actual cost in dollars
                  </label>
                  <input
                    id={`cost-${fulfillmentId}`}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    inputMode="decimal"
                    autoComplete="off"
                    value={cost}
                    onChange={(event) => {
                      setCost(event.target.value);
                      setWarning(null);
                    }}
                  />
                  <p className="text-sm text-muted-foreground">Zero is allowed.</p>
                </div>
              ) : null}
              <NoteField id={`note-${fulfillmentId}-${action.kind}`} note={note} onNote={setNote} />
              {warning ? (
                <p className="text-sm text-destructive" role="alert">
                  {warning}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {warning && action.kind === 'fulfill' ? (
                  <Button type="button" size="sm" disabled={pending} onClick={() => void submit(action.kind, true)}>
                    Yes, record above allowance
                  </Button>
                ) : (
                  <Button type="button" size="sm" disabled={pending} onClick={() => void submit(action.kind, false)}>
                    {action.confirmLabel}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setConfirming(null);
                    setWarning(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
              {action.confirmNote ? <p className="text-sm">{action.confirmNote}</p> : null}
            </div>
          ) : (
            <Button
              key={action.kind}
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || confirming !== null}
              onClick={() => {
                setConfirming(action.kind);
                setCost('');
                setNote('');
                setWarning(null);
                setMessage(null);
                setError(null);
              }}
            >
              {action.label}
            </Button>
          ),
        )}
      </div>
    </div>
  );
}
