'use client';

import { PassportChrome } from '@/components/passport/passport-chrome';
import { PassportMapView } from '@/components/passport/passport-map-view';
import type { PassportClientProps } from '@/components/passport/passport-client';
import { MAP_SEGMENT_HREF, stampKind } from '@/lib/passport/passport-board';

export function PassportMapScreen({
  userDisplayName,
  visits,
  currentStreak,
  longestStreak,
  progressUnavailable = false,
  uniqueRestaurants,
  neighborhoods,
  verifiedVisits,
  pendingVisits,
  earnedBadges,
  showFirstBiteLocked,
  partnerNeighborhoods = null,
}: PassportClientProps) {
  const stamps = visits.filter((visit) => stampKind(visit.visitStatus) === 'stamp');
  const pending = visits.filter((visit) => stampKind(visit.visitStatus) === 'pending');
  const visitCount = verifiedVisits ?? stamps.length;
  const pendingCount = pendingVisits ?? pending.length;

  return (
    <PassportChrome
      displayName={userDisplayName}
      segment="map"
      progressUnavailable={progressUnavailable}
      verifiedVisits={visitCount}
      uniqueRestaurants={uniqueRestaurants}
      neighborhoods={neighborhoods}
      currentStreak={currentStreak}
      longestStreak={longestStreak}
      pendingVisits={pendingCount}
      earnedBadges={earnedBadges}
      showFirstBiteLocked={showFirstBiteLocked}
      retryHref={MAP_SEGMENT_HREF}
    >
      <PassportMapView
        visits={visits}
        neighborhoods={progressUnavailable ? null : neighborhoods}
        partnerNeighborhoods={partnerNeighborhoods}
      />
    </PassportChrome>
  );
}
