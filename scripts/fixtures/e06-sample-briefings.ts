/**
 * Local sample first-visit facts for scripts/seed.ts.
 * Fictional wording and example.com links. Not real venues and not official claims.
 * is_sample stays true. The migration does not insert these rows.
 * One restaurant gets active facts. A paused fact is stored and must not render.
 * The other seeded restaurants have no facts, so their cards stay unchanged.
 */
export type SampleBriefingSeed = {
  restaurantName: string;
  field: 'parking' | 'arrival' | 'what_to_expect' | 'duration' | 'attire' | 'accessibility';
  body: string;
  sourceUrl: string;
  status: 'active' | 'paused';
};

export const SAMPLE_BRIEFING_SEEDS: readonly SampleBriefingSeed[] = [
  {
    restaurantName: 'Hutchins BBQ',
    field: 'parking',
    body: 'Sample note: street parking is described on the sample page. This is not a real-venue claim.',
    sourceUrl: 'https://example.com/sample-hutchins-parking',
    status: 'active',
  },
  {
    restaurantName: 'Hutchins BBQ',
    field: 'arrival',
    body: 'Sample note: the sample page says to use the front door. This is not a real-venue claim.',
    sourceUrl: 'https://example.com/sample-hutchins-arrival',
    status: 'active',
  },
  {
    restaurantName: 'Hutchins BBQ',
    field: 'duration',
    body: 'Sample note: the sample page says a typical visit is about an hour. This is not a real-venue claim.',
    sourceUrl: 'https://example.com/sample-hutchins-duration',
    status: 'active',
  },
  {
    restaurantName: 'Hutchins BBQ',
    field: 'accessibility',
    body: 'Sample note: a paused ramp claim that must stay hidden. This is not a real-venue claim.',
    sourceUrl: 'https://example.com/sample-hutchins-paused',
    status: 'paused',
  },
];
