import { parseProgressionBackfillArgs } from './backfill';
import { chicagoDateMidnight } from './entries-from';

const dates = ['2026-11-01', '2026-10-01', '2027-01-01'];
const instants = Object.fromEntries(dates.map((day) => [day, chicagoDateMidnight(day).toISOString()]));
const parsed = parseProgressionBackfillArgs(['--entries-from', '2027-01-01']);
const apply = 'error' in parsed || parsed.help ? null : parsed.apply;
const entriesFrom = 'error' in parsed || parsed.help ? null : parsed.entriesFrom;

process.stdout.write(`${JSON.stringify({ instants, apply, entriesFrom })}\n`);
