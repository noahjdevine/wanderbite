import { quarterOptions } from './campaign-editor';

const samples = [
  '2026-12-31T23:30:00-06:00',
  '2027-01-01T05:30:00.000Z',
  '2026-11-12T18:00:00.000Z',
  '2027-01-01T06:00:00.000Z',
];

const quarters = Object.fromEntries(samples.map((iso) => [iso, quarterOptions(iso)]));
process.stdout.write(`${JSON.stringify({ tz: process.env.TZ ?? null, quarters })}\n`);
