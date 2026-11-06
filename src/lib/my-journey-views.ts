export const MY_JOURNEY_VIEWS = ['journey', 'journal', 'passport'] as const;

export type MyJourneyHubView = (typeof MY_JOURNEY_VIEWS)[number];

/** Progress, Journal, Passport, and the Passport map segment. */
export type MyJourneyView = MyJourneyHubView | 'map';

export const MY_JOURNEY_VIEW_LABELS: Record<MyJourneyView, string> = {
  journey: 'Progress',
  journal: 'Journal',
  passport: 'Passport',
  map: 'Map',
};

export function parseMyJourneyView(
  value: string | string[] | undefined
): MyJourneyView {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'journal' || raw === 'passport' || raw === 'map') return raw;
  return 'journey';
}

/** Canonical URL for each surface. `/journey?view=journal` still redirects to Journal. */
export function myJourneyHref(view: MyJourneyView): string {
  if (view === 'journey') return '/journey';
  if (view === 'journal') return '/journal';
  return `/journey?view=${view}`;
}
