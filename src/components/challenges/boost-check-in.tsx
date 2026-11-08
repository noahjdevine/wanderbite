'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { checkInMemberBoost } from '@/app/actions/member-boost-arrival';
import { CtaButton } from '@/components/wb/cta-button';

export const BOOST_CHECK_IN_LABEL = "I'm here — lock Boost";
export const BOOST_CHECK_IN_LOCKED =
  'Boost is locked for this visit. Your usual discount still works if you need a code.';
export const BOOST_CHECK_IN_LOCATION_OFF =
  'Location is off, so Boost stays unlocked. Your usual discount still works.';
export const BOOST_CHECK_IN_LOCATION_FAILED =
  "We couldn't read a fresh location. Your usual discount still works.";

type BoostCheckInProps = {
  /** Exact E07_ARRIVAL_SESSIONS_ENABLED, plus an assigned bound item with a pin. */
  enabled: boolean;
  challengeItemId: string;
};

function noteFor(code: string): string {
  switch (code) {
    case 'out_of_radius':
      return "You're not close enough to this restaurant to lock Boost. Your usual discount still works.";
    case 'stale_location':
      return 'That location reading is too old. Try again. Your usual discount still works.';
    case 'poor_accuracy':
    case 'missing_accuracy':
      return "That location isn't precise enough to lock Boost. Your usual discount still works.";
    case 'restaurant_location_unavailable':
      return "This restaurant isn't set up for a location check-in. Your usual discount still works.";
    case 'boost_not_available':
      return "Boost isn't on at this restaurant right now. Your usual discount still works.";
    case 'session_open':
      return 'This visit already has a Boost check-in. Your usual discount still works.';
    default:
      return "Boost isn't locked. Your usual discount still works.";
  }
}

function memberKey(challengeItemId: string): string {
  return `e07-member-geo:${challengeItemId}`;
}

/**
 * Boost check-in beside the redemption code. Geolocation runs on tap, not on load.
 * While the flag is off this renders nothing and does not touch the browser location.
 */
export function BoostCheckIn({ enabled, challengeItemId }: BoostCheckInProps) {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  if (!enabled) return null;

  async function shareLocation() {
    if (pending || locked) return;
    const geolocation = navigator.geolocation;
    if (!geolocation) {
      setNote(BOOST_CHECK_IN_LOCATION_FAILED);
      return;
    }
    setPending(true);
    setNote(null);
    geolocation.getCurrentPosition(
      (position) => {
        void checkInMemberBoost({
          challengeItemId,
          idempotencyKey: memberKey(challengeItemId),
          location: {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          },
        })
          .then((result) => {
            if (result.ok) {
              setLocked(true);
              setNote(BOOST_CHECK_IN_LOCKED);
              return;
            }
            setNote(noteFor(result.code));
          })
          .catch(() => {
            setNote(noteFor('unavailable'));
          })
          .finally(() => {
            setPending(false);
          });
      },
      (error) => {
        setPending(false);
        setNote(error.code === 1 ? BOOST_CHECK_IN_LOCATION_OFF : BOOST_CHECK_IN_LOCATION_FAILED);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <CtaButton
        variant="secondary-cream"
        creamStyle="outline"
        className="min-h-[52px] w-full"
        disabled={pending || locked}
        type="button"
        onClick={() => {
          void shareLocation();
        }}
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
            Checking your location…
          </>
        ) : (
          BOOST_CHECK_IN_LABEL
        )}
      </CtaButton>
      {note ? (
        <p role="status" className="m-0 text-sm text-wb-muted">
          {note}
        </p>
      ) : null}
    </div>
  );
}
