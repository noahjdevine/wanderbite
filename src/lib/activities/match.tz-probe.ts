import {
  activityBoundMiles,
  chicagoCalendarDate,
  matchActivities,
} from './match';
import type { ActivityRecord } from './types';

const evening = new Date('2026-11-05T05:30:00.000Z');
const morning = new Date('2026-11-05T06:30:00.000Z');
const verified = '2026-11-01T18:00:00.000Z';

function row(id: string, validUntil: string): ActivityRecord {
  return {
    id,
    name: id,
    category: 'arts',
    source_url: 'https://example.com/sample-dated-fair',
    lat: 33.198,
    lon: -96.616,
    zip: '75069',
    typical_duration_minutes: 30,
    cost_category: 'free',
    hours_note: null,
    valid_from: null,
    valid_until: validUntil,
    weather_dependent: false,
    booking_required: false,
    last_verified_at: verified,
    status: 'active',
    is_sample: true,
    version: 1,
  };
}

function ids(now: Date): string[] {
  return matchActivities({
    restaurant: {
      id: 'restaurant',
      lat: 33.1972,
      lon: -96.6156,
      address: '1 Sample St, McKinney, TX 75069',
    },
    activities: [row('ended-yesterday', '2026-11-03'), row('through-evening', '2026-11-04')],
    distanceBand: '15_mi',
    now,
    nodeEnv: 'production',
  }).map((suggestion) => suggestion.id);
}

process.stdout.write(
  `${JSON.stringify({
    bound: activityBoundMiles('15_mi'),
    eveningDate: chicagoCalendarDate(evening),
    morningDate: chicagoCalendarDate(morning),
    eveningIds: ids(evening),
    morningIds: ids(morning),
  })}\n`,
);
