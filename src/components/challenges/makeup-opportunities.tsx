'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startMakeupVisit } from '@/app/actions/visit-problems';
import type { MemberMakeupSpot } from '@/lib/boost/visit-problem';

/**
 * One granted make-up visit per reviewed case. An available spot starts the
 * existing code path. A used spot stays used. An empty list renders nothing.
 */
export function MakeupOpportunities({ spots }: { spots: readonly MemberMakeupSpot[] }) {
  if (spots.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="makeup-challenges">
      <h2 id="makeup-challenges" className="m-0 text-lg font-semibold text-wb-ink">
        Make-up challenge
      </h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {spots.map((spot) => (
          <MakeupSpotCard key={spot.id} spot={spot} />
        ))}
      </ul>
    </section>
  );
}

function MakeupSpotCard({ spot }: { spot: MemberMakeupSpot }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const used = spot.status === 'used';

  async function onStart() {
    setPending(true);
    setError(null);
    const result = await startMakeupVisit(spot.id);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push(`/challenges/show/${result.redemptionId}`);
  }

  return (
    <li className="rounded-2xl border border-[#e3d9c6] bg-[#f4efe6] px-4 py-3">
      <p className="m-0 text-sm font-medium text-wb-ink">Extra visit at {spot.restaurantName}</p>
      {used ? (
        <p className="m-0 mt-1 text-sm text-wb-ink">Used.</p>
      ) : spot.bookable ? (
        <>
          <p className="m-0 mt-1 text-sm text-wb-ink">You can use this visit to get your code.</p>
          <button
            className="mt-3 rounded-full bg-wb-plum px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={pending}
            type="button"
            onClick={() => void onStart()}
          >
            {pending ? 'Getting your code…' : "I'm here — get my code"}
          </button>
        </>
      ) : (
        <p className="m-0 mt-1 text-sm text-wb-ink">{spot.unavailableMessage}</p>
      )}
      {error ? (
        <p className="m-0 mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
