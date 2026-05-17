export const MY_JOURNEY_VIEWS = ['journey', 'journal', 'passport'] as const;

export type MyJourneyView = (typeof MY_JOURNEY_VIEWS)[number];

export const MY_JOURNEY_VIEW_LABELS: Record<MyJourneyView, string> = {
  journey: 'Journey',
  journal: 'Journal',
  passport: 'Passport',
};

export function parseMyJourneyView(
  value: string | string[] | undefined
): MyJourneyView {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'journal' || raw === 'passport') return raw;
  return 'journey';
}

export function myJourneyHref(view: MyJourneyView): string {
  if (view === 'journey') return '/journey';
  return `/journey?view=${view}`;
}
