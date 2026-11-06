/**
 * Signed-in mobile tab bar. Four tabs:
 * Discover `/roulette`, Challenges `/challenges`, Progress `/journey`,
 * Passport `/journey?view=passport` (stamps). Map (`/journey?view=map`) is a
 * Passport segment. Journal is its own page and does not light a tab.
 */

export const DISCOVER_TAB_HREF = '/roulette';
export const CHALLENGES_TAB_HREF = '/challenges';
export const PROGRESS_TAB_HREF = '/journey';
export const PASSPORT_TAB_HREF = '/journey?view=passport';

/** Passport segments. Journal is not one of them. */
const PASSPORT_VIEWS = new Set(['passport', 'map']);

/**
 * The bar is not mounted on partner, onboarding, checkout, or the dev gallery.
 * These prefixes still hide it if a layout that does mount it is showing the path.
 */
export const MEMBER_TAB_BAR_HIDDEN_PREFIXES = [
  '/partner',
  '/admin',
  '/onboarding',
  '/signin',
  '/signup',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/auth',
  '/contact',
  '/privacy',
  '/terms',
  '/rules',
  '/checkout',
  '/challenges/show',
  '/dev',
] as const;

export function normalizeMemberPath(pathname: string): string {
  const path = pathname.split('?')[0]?.split('#')[0] ?? '/';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path || '/';
}

function pathMatches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Href of the active tab, or null when the path is not one of the four.
 * `/journey/*` lights Progress, except Passport segments on `/journey` itself.
 * `/passport` lights Passport. Journal (`/journal`, the note editor, and
 * `/journey?view=journal`) leaves every tab inactive.
 */
export function resolveMemberTabHref(pathname: string, search = ''): string | null {
  const path = normalizeMemberPath(pathname);
  const query = search.startsWith('?') ? search.slice(1) : search;
  const view = new URLSearchParams(query).get('view');

  if (pathMatches(path, DISCOVER_TAB_HREF)) return DISCOVER_TAB_HREF;
  if (pathMatches(path, CHALLENGES_TAB_HREF)) return CHALLENGES_TAB_HREF;
  if (pathMatches(path, '/passport')) return PASSPORT_TAB_HREF;
  if (pathMatches(path, '/journal')) return null;
  if (pathMatches(path, PROGRESS_TAB_HREF)) {
    if (path === PROGRESS_TAB_HREF && view === 'journal') return null;
    if (path === PROGRESS_TAB_HREF && view != null && PASSPORT_VIEWS.has(view)) {
      return PASSPORT_TAB_HREF;
    }
    return PROGRESS_TAB_HREF;
  }
  return null;
}

export function shouldShowMemberTabBar(pathname: string, signedIn: boolean): boolean {
  if (!signedIn) return false;
  const path = normalizeMemberPath(pathname);
  return !MEMBER_TAB_BAR_HIDDEN_PREFIXES.some((prefix) => pathMatches(path, prefix));
}
