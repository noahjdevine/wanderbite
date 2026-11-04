export const MY_JOURNEY_VIEWS = ['journey', 'journal', 'passport'] as const;

export type MyJourneyHubView = (typeof MY_JOURNEY_VIEWS)[number];

/** Hub tabs stay Progress, Journal, and Passport. Map is a Passport segment. */
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

export function myJourneyHref(view: MyJourneyView): string {
  if (view === 'journey') return '/journey';
  return `/journey?view=${view}`;
}
