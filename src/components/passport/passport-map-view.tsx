'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { PassportMapMarkers } from '@/components/passport/passport-map-canvas';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import { chicagoVisitDate, stampKind } from '@/lib/passport/passport-board';
import {
  mapPoints,
  neighborhoodCounterLabel,
  visitsNotOnMap,
  type MapPoint,
  type PassportMapVisit,
} from '@/lib/passport/passport-map';

const MAP_CITY = LAUNCH_MARKET.displayName.split(',')[0]?.trim() || 'McKinney';

function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function MapFrame({ points }: { points: MapPoint[] }) {
  const client = useIsClient();
  if (!client) {
    return (
      <div className="wb-map-frame flex items-center justify-center text-sm text-wb-muted" role="status">
        Loading map
      </div>
    );
  }
  return <PassportMapMarkers points={points} />;
}

type PassportMapViewProps = {
  visits: readonly PassportMapVisit[];
  /** `getMemberProgress` neighborhood count. Not recounted from the visits on this page. */
  neighborhoods: number | null;
  /** Distinct neighborhoods on active restaurants in the launch market. */
  partnerNeighborhoods: number | null;
};

export function PassportMapView({
  visits,
  neighborhoods,
  partnerNeighborhoods,
}: PassportMapViewProps) {
  const points = useMemo(() => mapPoints(visits), [visits]);
  const missing = useMemo(() => visitsNotOnMap(visits), [visits]);
  const label = neighborhoodCounterLabel(neighborhoods, partnerNeighborhoods, MAP_CITY);
  const empty = !visits.some((visit) => stampKind(visit.visitStatus) === 'stamp');

  return (
    <section aria-labelledby="passport-map" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="passport-map" className="font-display m-0 text-[30px] leading-none text-wb-ink">
          Map
        </h2>
        {label ? (
          <p className="m-0 text-sm font-semibold text-wb-ink" data-neighborhood-counter="">
            {label}
          </p>
        ) : null}
      </div>
      {empty ? (
        <p className="m-0 text-sm text-wb-muted" data-passport-map-empty="">
          Your passport is empty. A visit shows up on the map after it is verified.
        </p>
      ) : (
        <>
          <ol className="sr-only" data-route-order="">
            {points.map((point) => (
              <li key={point.id}>{point.name}</li>
            ))}
          </ol>
          <MapFrame points={points} />
          {missing.length > 0 ? (
            <section aria-labelledby="not-on-map">
              <h3 id="not-on-map" className="font-display m-0 text-[22px] leading-none text-wb-ink">
                Not on the map yet
              </h3>
              <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                {missing.map((visit) => (
                  <li
                    key={visit.id}
                    className="rounded-2xl bg-white px-4 py-3 text-sm shadow-[0_10px_24px_rgba(42,20,66,0.06)]"
                  >
                    <span className="font-semibold text-wb-ink">{visit.restaurant.name}</span>
                    <span className="mt-0.5 block text-wb-muted">
                      {chicagoVisitDate(visit.verifiedAt)?.long ?? 'Date unavailable'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
