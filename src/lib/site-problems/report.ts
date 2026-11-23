import { stripSensitiveSearchParams } from '@/lib/sensitive-url';

export const WHAT_HAPPENED_MIN = 10;
export const WHAT_HAPPENED_MAX = 2000;
export const TRYING_TO_DO_MAX = 1000;
export const PAGE_PATH_MAX = 300;
export const CONTACT_EMAIL_MAX = 254;
export const USER_AGENT_MAX = 300;
export const ADMIN_NOTE_MAX = 500;

export const SITE_PROBLEM_STATUSES = ['new', 'reviewed', 'closed'] as const;
export type SiteProblemStatus = (typeof SITE_PROBLEM_STATUSES)[number];

export const RATE_LIMIT_MESSAGE =
  "You've sent a few reports already. Please wait a bit and try again.";
export const SAVE_FAILED_MESSAGE = "We couldn't save that report. Please try again.";
export const REJECTED_MESSAGE = "We couldn't send that report. Please try again.";
export const DISABLED_MESSAGE = 'Reporting a problem is turned off.';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE_PATH_RE = /^\/(?:[A-Za-z0-9\-._~!$&'()*+,;=:@]|\/)*$/;
const PAGE_QUERY_RE = /^\?[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]*$/;

export type SiteProblemSubmission =
  | {
      ok: true;
      whatHappened: string;
      tryingToDo: string | null;
      pagePath: string | null;
      contactEmail: string | null;
    }
  | {
      ok: false;
      code: 'rejected' | 'what_happened' | 'trying_to_do' | 'page_path' | 'email';
      message: string;
    };

function codePoints(value: string): string[] {
  return Array.from(value);
}

export function truncateUserAgent(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return codePoints(trimmed).slice(0, USER_AGENT_MAX).join('');
}

/**
 * Same-site relative path, or null when the value is empty or unsafe.
 * Absolute URLs, protocol-relative URLs, and javascript: are dropped.
 */
export function sanitizeReportPagePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || codePoints(trimmed).length > PAGE_PATH_MAX) return null;

  let path = trimmed;
  if (trimmed.includes('%')) {
    try {
      path = decodeURIComponent(trimmed);
    } catch {
      return null;
    }
  }
  if (!path || codePoints(path).length > PAGE_PATH_MAX) return null;

  const hash = path.indexOf('#');
  if (hash >= 0) path = path.slice(0, hash);
  if (!path) return null;

  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  if (/[\u0000-\u001F\u007F\s]/.test(path)) return null;
  if (path.toLowerCase().includes('javascript:')) return null;
  if (path.includes('://')) return null;

  const queryAt = path.indexOf('?');
  const pathname = queryAt >= 0 ? path.slice(0, queryAt) : path;
  const query = queryAt >= 0 ? path.slice(queryAt) : '';
  if (!pathname || !PAGE_PATH_RE.test(pathname)) return null;
  if (query && !PAGE_QUERY_RE.test(query)) return null;
  if (!query) return pathname;
  const params = new URLSearchParams(query.slice(1));
  stripSensitiveSearchParams(params);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function reportProblemHref(pathname: string, search = ''): string {
  const joined = search
    ? `${pathname}${search.startsWith('?') ? search : `?${search}`}`
    : pathname;
  const from = sanitizeReportPagePath(joined);
  if (!from || from === '/report-a-problem' || from.startsWith('/report-a-problem?')) {
    return '/report-a-problem';
  }
  return `/report-a-problem?from=${encodeURIComponent(from)}`;
}

export function parseSiteProblemSubmission(input: {
  whatHappened: unknown;
  tryingToDo: unknown;
  pagePath: unknown;
  contactEmail: unknown;
  honeypot: unknown;
  signedIn: boolean;
}): SiteProblemSubmission {
  if (typeof input.honeypot === 'string' && input.honeypot.trim() !== '') {
    return { ok: false, code: 'rejected', message: REJECTED_MESSAGE };
  }

  if (typeof input.whatHappened !== 'string') {
    return {
      ok: false,
      code: 'what_happened',
      message: 'Tell us what happened in a sentence or two.',
    };
  }
  const whatHappened = input.whatHappened.trim();
  const whatLength = codePoints(whatHappened).length;
  if (whatLength < WHAT_HAPPENED_MIN) {
    return {
      ok: false,
      code: 'what_happened',
      message: 'Tell us what happened in a sentence or two.',
    };
  }
  if (whatLength > WHAT_HAPPENED_MAX) {
    return {
      ok: false,
      code: 'what_happened',
      message: 'That is a bit long. Please keep it under 2000 characters.',
    };
  }

  let tryingToDo: string | null = null;
  if (typeof input.tryingToDo === 'string' && input.tryingToDo.trim() !== '') {
    tryingToDo = input.tryingToDo.trim();
    if (codePoints(tryingToDo).length > TRYING_TO_DO_MAX) {
      return {
        ok: false,
        code: 'trying_to_do',
        message: 'The “trying to do” note is too long. Please keep it under 1000 characters.',
      };
    }
  }

  let pagePath: string | null = null;
  if (typeof input.pagePath === 'string' && input.pagePath.trim() !== '') {
    if (codePoints(input.pagePath.trim()).length > PAGE_PATH_MAX) {
      return {
        ok: false,
        code: 'page_path',
        message: 'That page address is too long.',
      };
    }
    pagePath = sanitizeReportPagePath(input.pagePath);
  }

  let contactEmail: string | null = null;
  if (!input.signedIn && typeof input.contactEmail === 'string' && input.contactEmail.trim() !== '') {
    const email = input.contactEmail.trim().toLowerCase();
    if (codePoints(email).length > CONTACT_EMAIL_MAX || !EMAIL_RE.test(email)) {
      return {
        ok: false,
        code: 'email',
        message: "That email doesn't look right. You can leave it blank.",
      };
    }
    contactEmail = email;
  }

  return { ok: true, whatHappened, tryingToDo, pagePath, contactEmail };
}

export function parseSiteProblemStatus(value: unknown): SiteProblemStatus | null {
  if (typeof value !== 'string') return null;
  return SITE_PROBLEM_STATUSES.find((status) => status === value) ?? null;
}

export function parseAdminNote(value: unknown): { ok: true; note: string | null } | { ok: false } {
  if (value == null) return { ok: true, note: null };
  if (typeof value !== 'string') return { ok: false };
  const note = value.trim();
  if (!note) return { ok: true, note: null };
  if (codePoints(note).length > ADMIN_NOTE_MAX) return { ok: false };
  return { ok: true, note };
}

const chicagoReportTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  calendar: 'gregory',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** America/Chicago date and time for the admin list. Unparseable input is null. */
export function formatChicagoReportTime(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return chicagoReportTime.format(date);
}

export function siteProblemWho(input: {
  userId: string | null;
  memberEmail: string | null;
  contactEmail: string | null;
}): string {
  if (input.userId) {
    const email = input.memberEmail?.trim();
    return email || 'member';
  }
  const contact = input.contactEmail?.trim();
  return contact || 'anonymous';
}

export function reportLimitSubject(input: {
  userId: string | null;
  ipHash: string | null;
}): string | null {
  if (input.userId) return `user:${input.userId}`;
  if (input.ipHash) return `ip:${input.ipHash}`;
  return null;
}
