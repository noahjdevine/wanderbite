import { describe, expect, it } from 'vitest';
import { siteProblemReportsEnabled } from '@/lib/site-problems/flag';
import {
  formatChicagoReportTime,
  parseAdminNote,
  parseSiteProblemSubmission,
  reportLimitSubject,
  reportProblemHref,
  sanitizeReportPagePath,
  siteProblemWho,
  truncateUserAgent,
} from '@/lib/site-problems/report';

const LONG_ENOUGH = 'The button did nothing at all';

describe('site problem report flag', () => {
  it('is on only for the exact string true', () => {
    expect(siteProblemReportsEnabled('true')).toBe(true);
    expect(siteProblemReportsEnabled(undefined)).toBe(false);
    expect(siteProblemReportsEnabled('')).toBe(false);
    expect(siteProblemReportsEnabled('TRUE')).toBe(false);
    expect(siteProblemReportsEnabled('1')).toBe(false);
  });
});

describe('sanitizeReportPagePath', () => {
  it('keeps a same-site relative path and strips a secret query', () => {
    expect(sanitizeReportPagePath('/challenges')).toBe('/challenges');
    expect(sanitizeReportPagePath('/journey?view=passport')).toBe('/journey?view=passport');
    expect(sanitizeReportPagePath('/restaurants/some-slug')).toBe('/restaurants/some-slug');
    expect(sanitizeReportPagePath('  /challenges  ')).toBe('/challenges');
    expect(sanitizeReportPagePath('/challenges?code=secret&checkout=success')).toBe(
      '/challenges?checkout=success',
    );
  });

  it('drops absolute URLs, protocol-relative URLs, and javascript', () => {
    expect(sanitizeReportPagePath('https://evil.com/phish')).toBeNull();
    expect(sanitizeReportPagePath('http://wanderbite.co/challenges')).toBeNull();
    expect(sanitizeReportPagePath('//evil.com')).toBeNull();
    expect(sanitizeReportPagePath('//evil.com/path')).toBeNull();
    expect(sanitizeReportPagePath('/%2F%2Fevil.com')).toBeNull();
    expect(sanitizeReportPagePath('javascript:alert(1)')).toBeNull();
    expect(sanitizeReportPagePath('/javascript:alert(1)')).toBeNull();
    expect(sanitizeReportPagePath('/\\evil.com')).toBeNull();
    expect(sanitizeReportPagePath('')).toBeNull();
    expect(sanitizeReportPagePath('challenges')).toBeNull();
    expect(sanitizeReportPagePath(null)).toBeNull();
  });
});

describe('reportProblemHref', () => {
  it('passes the current page and drops an unsafe one', () => {
    expect(reportProblemHref('/challenges')).toBe('/report-a-problem?from=%2Fchallenges');
    expect(reportProblemHref('/journey', 'view=passport')).toBe(
      '/report-a-problem?from=%2Fjourney%3Fview%3Dpassport',
    );
    expect(reportProblemHref('https://evil.com')).toBe('/report-a-problem');
    expect(reportProblemHref('//evil.com')).toBe('/report-a-problem');
    expect(reportProblemHref('/report-a-problem')).toBe('/report-a-problem');
  });
});

describe('parseSiteProblemSubmission', () => {
  it('rejects a short story, a long note, a bad email, and a filled honeypot', () => {
    expect(parseSiteProblemSubmission({
      whatHappened: 'too short',
      tryingToDo: '',
      pagePath: '/challenges',
      contactEmail: '',
      honeypot: '',
      signedIn: false,
    }).ok).toBe(false);

    const longNote = parseSiteProblemSubmission({
      whatHappened: LONG_ENOUGH,
      tryingToDo: 'x'.repeat(1001),
      pagePath: '',
      contactEmail: '',
      honeypot: '',
      signedIn: false,
    });
    expect(longNote.ok).toBe(false);
    if (!longNote.ok) expect(longNote.code).toBe('trying_to_do');

    const email = parseSiteProblemSubmission({
      whatHappened: LONG_ENOUGH,
      tryingToDo: '',
      pagePath: '',
      contactEmail: 'not-an-email',
      honeypot: '',
      signedIn: false,
    });
    expect(email.ok).toBe(false);
    if (!email.ok) expect(email.code).toBe('email');

    const honeypot = parseSiteProblemSubmission({
      whatHappened: LONG_ENOUGH,
      tryingToDo: '',
      pagePath: '/challenges',
      contactEmail: '',
      honeypot: 'https://spam.example',
      signedIn: false,
    });
    expect(honeypot.ok).toBe(false);
    if (!honeypot.ok) expect(honeypot.code).toBe('rejected');
  });

  it('keeps a visitor email and drops an unsafe page', () => {
    const parsed = parseSiteProblemSubmission({
      whatHappened: `  ${LONG_ENOUGH}  `,
      tryingToDo: '  Open my challenge  ',
      pagePath: 'https://evil.com',
      contactEmail: ' Guest@Example.com ',
      honeypot: '',
      signedIn: false,
    });
    expect(parsed).toEqual({
      ok: true,
      whatHappened: LONG_ENOUGH,
      tryingToDo: 'Open my challenge',
      pagePath: null,
      contactEmail: 'guest@example.com',
    });
  });

  it('does not keep an email for a signed-in member', () => {
    const parsed = parseSiteProblemSubmission({
      whatHappened: LONG_ENOUGH,
      tryingToDo: '',
      pagePath: '/challenges',
      contactEmail: 'guest@example.com',
      honeypot: '',
      signedIn: true,
    });
    expect(parsed).toMatchObject({ ok: true, contactEmail: null, pagePath: '/challenges' });
  });
});

describe('site problem report helpers', () => {
  it('truncates the user agent to 300 characters', () => {
    expect(truncateUserAgent(`  ${'a'.repeat(305)}  `)?.length).toBe(300);
    expect(truncateUserAgent('   ')).toBeNull();
  });

  it('formats the admin time in America/Chicago', () => {
    const label = formatChicagoReportTime('2026-11-01T04:30:00.000Z');
    expect(label).toContain('Oct 31, 2026');
    expect(label).toContain('11:30');
    expect(formatChicagoReportTime('not-a-date')).toBeNull();
  });

  it('names a member, a contact email, or anonymous', () => {
    expect(siteProblemWho({
      userId: 'user-1',
      memberEmail: 'member@example.com',
      contactEmail: 'other@example.com',
    })).toBe('member@example.com');
    expect(siteProblemWho({
      userId: null,
      memberEmail: null,
      contactEmail: 'guest@example.com',
    })).toBe('guest@example.com');
    expect(siteProblemWho({ userId: null, memberEmail: null, contactEmail: null })).toBe('anonymous');
    expect(siteProblemWho({ userId: 'user-1', memberEmail: null, contactEmail: null })).toBe('member');
  });

  it('limits by user id or IP hash and never needs a raw IP', () => {
    expect(reportLimitSubject({ userId: 'user-1', ipHash: 'v1:abc' })).toBe('user:user-1');
    expect(reportLimitSubject({ userId: null, ipHash: 'v1:abc' })).toBe('ip:v1:abc');
    expect(reportLimitSubject({ userId: null, ipHash: null })).toBeNull();
  });

  it('accepts a short admin note and rejects a long one', () => {
    expect(parseAdminNote('  Saw it  ')).toEqual({ ok: true, note: 'Saw it' });
    expect(parseAdminNote('   ')).toEqual({ ok: true, note: null });
    expect(parseAdminNote('n'.repeat(501)).ok).toBe(false);
  });
});
