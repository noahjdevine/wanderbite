'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DRAWING_ADMIN_ACTION_SUCCESS,
  type DrawingAdminActionKind,
  type DrawingAdminActionOffer,
} from '@/lib/drawings/admin-actions';
import { activateCampaignAction, closeCampaignAction, runSelectionAction } from './actions';

/**
 * Second click confirms. The first click does not call the server action.
 */
export function DrawingCampaignActions({
  campaignId,
  actions,
}: {
  campaignId: string;
  actions: DrawingAdminActionOffer[];
}) {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState<DrawingAdminActionKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm(kind: DrawingAdminActionKind) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const result =
        kind === 'activate'
          ? await activateCampaignAction(campaignId)
          : kind === 'close'
            ? await closeCampaignAction(campaignId)
            : await runSelectionAction(campaignId);
      setConfirming(null);
      if (result.ok) {
        setMessage(DRAWING_ADMIN_ACTION_SUCCESS[kind]);
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
      <div className="flex flex-wrap gap-2">
        {actions.map((action) =>
          confirming === action.kind ? (
            <div key={action.kind} className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={pending} onClick={() => void confirm(action.kind)}>
                {action.confirmLabel}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setConfirming(null)}
              >
                Cancel
              </Button>
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
