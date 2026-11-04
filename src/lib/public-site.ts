/**
 * Canonical public origin for member-facing share links.
 * Auth email redirects stay on `getEmailConfirmCallbackUrl` and may follow
 * `NEXT_PUBLIC_SITE_URL`. Share links do not.
 */
export const PUBLIC_SITE_ORIGIN = 'https://wanderbite.co';

export function publicShareUrl(path = '/'): string {
  if (path === '' || path === '/') return PUBLIC_SITE_ORIGIN;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${PUBLIC_SITE_ORIGIN}${suffix}`;
}
