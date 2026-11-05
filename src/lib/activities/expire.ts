import { chicagoCalendarDate } from '@/lib/activities/match';

export type ExpirableActivity = {
  id: string;
  name: string;
  status: string;
  valid_until: string | null;
};

/**
 * Active rows whose valid_until is before today's America/Chicago date.
 * A null valid_until stays. Today stays. Rows are not deleted.
 */
export function activitiesToExpire<T extends ExpirableActivity>(
  rows: readonly T[],
  now: Date,
): T[] {
  const today = chicagoCalendarDate(now);
  if (!today) return [];
  return rows.filter((row) => {
    if (row.status !== 'active') return false;
    if (!row.valid_until) return false;
    return row.valid_until < today;
  });
}
