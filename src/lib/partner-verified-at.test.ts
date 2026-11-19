import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatMemberVerifiedAt, formatPartnerVerifiedAt } from '@/lib/partner-verified-at';

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

describe('formatMemberVerifiedAt', () => {
  it('prints the partner Chicago clock with a CT label', () => {
    // 11:22 AM CT. UTC is 5:22 PM. US Eastern is 12:22 PM.
    expect(formatMemberVerifiedAt('2026-11-19T17:22:00.000Z')).toBe('Nov 19, 2026, 11:22 AM CT');
    expect(formatMemberVerifiedAt('2026-07-14T15:14:00Z')).toBe('Jul 14, 2026, 10:14 AM CT');
    expect(formatMemberVerifiedAt('2026-11-05T01:00:00.000Z')).toBe('Nov 4, 2026, 7:00 PM CT');
  });

  it('hides a missing or invalid instant', () => {
    expect(formatMemberVerifiedAt(null)).toBeNull();
    expect(formatMemberVerifiedAt(undefined)).toBeNull();
    expect(formatMemberVerifiedAt('')).toBeNull();
    expect(formatMemberVerifiedAt('not-a-date')).toBeNull();
  });

  it('is the show-code clock on the server page and the live client', () => {
    const root = process.cwd();
    const page = readFileSync(
      path.join(root, 'src/app/(site)/challenges/show/[redemptionId]/page.tsx'),
      'utf8',
    );
    const client = readFileSync(
      path.join(root, 'src/components/challenges/show-redemption-code.tsx'),
      'utf8',
    );
    expect(page).toContain('formatMemberVerifiedAt(verifiedIso)');
    expect(client).toContain('formatMemberVerifiedAt(iso)');
    expect(page).not.toContain("format(new Date");
    expect(client).not.toContain("format(at, 'PPp')");
  });
});
