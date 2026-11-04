import type { VisitStatus } from '@/lib/visits/visit-status';

/** Matches `bite_notes` short-note length. There is no dish column. */
export const NOTE_MAX = 280;

export const PUBLIC_REVIEW_REQUIRES_VERIFIED =
  'Only a verified visit can be shared publicly.';

const RETURN_BASE = 'https://wanderbite.invalid';

const ALLOWED_RETURN_PATHS = new Set([
  '/journal',
  '/journey',
  '/passport',
  '/challenges',
  '/dashboard',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function redemptionIsVerified(
  status: string | null | undefined,
  verifiedAt: string | null | undefined,
): boolean {
  return status === 'verified' && typeof verifiedAt === 'string' && verifiedAt.length > 0;
}

/** Add memory only for a verified visit with no note. Edit only after note_added. */
export function memoryActionForStatus(status: VisitStatus): 'add' | 'edit' | null {
  if (status === 'verified') return 'add';
  if (status === 'note_added') return 'edit';
  return null;
}

export function visitElementId(redemptionId: string): string | null {
  if (!UUID_RE.test(redemptionId)) return null;
  return `visit-${redemptionId}`;
}

export function noteEditorHref(redemptionId: string, returnTo: string): string {
  const params = new URLSearchParams();
  params.set('return', returnTo);
  return `/journal/notes/${encodeURIComponent(redemptionId)}?${params.toString()}`;
}

/**
 * Allow only the member surfaces that open the editor.
 * Anything else, including an absolute URL, falls back to /journal.
 */
export function resolveNoteReturnTarget(
  raw: string | null | undefined,
  redemptionId: string,
): string {
  const hash = visitHash(redemptionId);
  const fallback = `/journal${hash}`;
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (trimmed.includes('\\') || /[\u0000-\u001F]/.test(trimmed)) return fallback;

  let url: URL;
  try {
    url = new URL(trimmed, RETURN_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== RETURN_BASE || url.username || url.password) return fallback;
  if (!ALLOWED_RETURN_PATHS.has(url.pathname)) return fallback;

  const keys = [...url.searchParams.keys()];
  if (url.pathname === '/journey') {
    const view = url.searchParams.get('view');
    const viewOk = view === 'journal' || view === 'passport';
    if (
      keys.length > 1 ||
      (keys.length === 1 && (!viewOk || url.searchParams.getAll('view').length !== 1))
    ) {
      return fallback;
    }
  } else if (keys.length > 0) {
    return fallback;
  }

  if (url.hash && url.hash !== hash) return fallback;
  const view = url.pathname === '/journey' ? url.searchParams.get('view') : null;
  const search = view ? `?view=${view}` : '';
  return `${url.pathname}${search}${hash}`;
}

function visitHash(redemptionId: string): string {
  const id = visitElementId(redemptionId);
  return id ? `#${id}` : '';
}
