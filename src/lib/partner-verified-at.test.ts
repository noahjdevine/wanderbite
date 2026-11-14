import { describe, expect, it } from 'vitest';
import { formatPartnerVerifiedAt } from '@/lib/partner-verified-at';

describe('formatPartnerVerifiedAt', () => {
  it('renders a November UTC instant as 9:14 AM CT', () => {
    expect(formatPartnerVerifiedAt('2026-11-14T15:14:00Z')).toBe('Nov 14, 2026, 9:14 AM CT');
  });

  it('keeps the CT label across daylight saving time', () => {
    expect(formatPartnerVerifiedAt('2026-07-14T15:14:00Z')).toBe('Jul 14, 2026, 10:14 AM CT');
    expect(formatPartnerVerifiedAt('2026-03-08T08:30:00Z')).toBe('Mar 8, 2026, 3:30 AM CT');
    expect(formatPartnerVerifiedAt('2026-11-01T07:30:00Z')).toBe('Nov 1, 2026, 1:30 AM CT');
  });

  it('uses a zone already on the row, and Chicago when that zone is unusable', () => {
    expect(formatPartnerVerifiedAt('2026-11-14T15:14:00Z', 'America/New_York')).toBe(
      'Nov 14, 2026, 10:14 AM EST',
    );
    expect(formatPartnerVerifiedAt('2026-11-14T15:14:00Z', 'Not/A_Timezone')).toBe(
      'Nov 14, 2026, 9:14 AM CT',
    );
    expect(formatPartnerVerifiedAt('not-a-date')).toBe('—');
  });
});
