'use client';

import { JourneySectionTabs } from '@/components/journey/journey-section-tabs';
import type { MyJourneyView } from '@/lib/my-journey-views';

type MyJourneyHubProps = {
  activeView: MyJourneyView;
  children: React.ReactNode;
};

export function MyJourneyHub({ activeView, children }: MyJourneyHubProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-6 md:py-10">
        <header className="space-y-4">
          <h1 className="text-3xl font-bold tracking-tight">Progress</h1>
          <JourneySectionTabs activeView={activeView} />
        </header>
        <div>{children}</div>
      </div>
    </div>
  );
}
