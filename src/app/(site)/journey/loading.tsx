import { Suspense } from 'react';
import { JourneyPending, ProgressPending } from '@/components/layout/member-surface-pending';

export default function JourneyLoading() {
  return (
    <Suspense fallback={<ProgressPending />}>
      <JourneyPending />
    </Suspense>
  );
}
