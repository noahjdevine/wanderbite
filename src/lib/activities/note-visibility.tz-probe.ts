import { noteCanShow } from './note-visibility';
import type { NoteVisibleActivity } from './note-visibility';

const evening = new Date('2026-11-05T05:30:00.000Z');
const morning = new Date('2026-11-05T06:30:00.000Z');
const id = 'through-evening';

const activity: NoteVisibleActivity = {
  id,
  status: 'active',
  is_sample: false,
  source_url: 'https://example.com/sample-dated-fair',
  valid_from: null,
  valid_until: '2026-11-04',
  last_verified_at: '2026-11-01T18:00:00.000Z',
};

function shown(now: Date): boolean {
  return noteCanShow(
    { status: 'approved', isSample: false, activityIds: [id] },
    new Map([[id, activity]]),
    now,
  );
}

process.stdout.write(`${JSON.stringify({ evening: shown(evening), morning: shown(morning) })}\n`);
