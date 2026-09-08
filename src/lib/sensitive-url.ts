/** Query keys that are one-time secrets in this app. */
export const SENSITIVE_QUERY_KEYS = ['code', 'token_hash'] as const;

/** Removed only when a sensitive query key is also present. */
export const AUTH_COMPANION_QUERY_KEYS = ['type'] as const;

const SENSITIVE_QUERY_KEY_SET = new Set<string>(SENSITIVE_QUERY_KEYS);
const AUTH_COMPANION_QUERY_KEY_SET = new Set<string>(AUTH_COMPANION_QUERY_KEYS);

const RECOVERY_HASH_MARKERS = ['type=recovery', 'access_token=', 'refresh_token='];

export function hasSensitiveQueryParam(searchParams: URLSearchParams): boolean {
  return SENSITIVE_QUERY_KEYS.some((key) => searchParams.has(key));
}

/** Mutates `searchParams`: drops secrets and companion `type` when a secret is present. */
export function stripSensitiveSearchParams(searchParams: URLSearchParams): void {
  const hadSecret = hasSensitiveQueryParam(searchParams);
  for (const key of SENSITIVE_QUERY_KEYS) {
    searchParams.delete(key);
  }
  if (hadSecret) {
    for (const key of AUTH_COMPANION_QUERY_KEYS) {
      searchParams.delete(key);
    }
  }
}

export function isSensitiveQueryKey(key: string): boolean {
  return SENSITIVE_QUERY_KEY_SET.has(key);
}

export function isAuthCompanionQueryKey(key: string): boolean {
  return AUTH_COMPANION_QUERY_KEY_SET.has(key);
}

/**
 * Browser navigation sanitizer: keep harmless query params, drop secrets.
 * `search` may be `''` or start with `?`. Pathname is preserved as given.
 */
export function sanitizeBrowserPath(pathname: string, search = ''): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  stripSensitiveSearchParams(params);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * Analytics/observability: known URL fields lose every query and fragment.
 * Returns the original value when it is not a string.
 */
export function originPathnameOnly(value: unknown): unknown {
  if (typeof value !== 'string' || value === '') return value;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    const cut = value.search(/[?#]/);
    return cut === -1 ? value : value.slice(0, cut);
  }
}

export function isUrlShaped(value: string): boolean {
  if (/^https?:\/\//i.test(value)) return true;
  return value.startsWith('/') && !value.startsWith('//');
}

export function hashLooksLikeRecoverySession(hash: string): boolean {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  return RECOVERY_HASH_MARKERS.some((marker) => raw.includes(marker));
}

function currentRelativeUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function replaceAddressBar(nextRelativeUrl: string): void {
  if (typeof window === 'undefined') return;
  if (nextRelativeUrl === currentRelativeUrl()) return;
  window.history.replaceState(window.history.state, '', nextRelativeUrl);
}

/** Remove sensitive query params from the address bar. Preserves `history.state`. */
export function stripSensitiveParamsFromAddressBar(): void {
  if (typeof window === 'undefined') return;
  const next = sanitizeBrowserPath(window.location.pathname, window.location.search);
  const hash = window.location.hash;
  replaceAddressBar(`${next}${hash}`);
}

/** After Supabase consumes an implicit recovery hash, drop it from the address bar. */
export function stripConsumedRecoveryHash(): void {
  if (typeof window === 'undefined') return;
  if (!hashLooksLikeRecoverySession(window.location.hash)) return;
  replaceAddressBar(`${window.location.pathname}${window.location.search}`);
}

export function readAuthSecretsFromSearch(search: string): {
  code: string | null;
  tokenHash: string | null;
} {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const code = params.get('code');
  const tokenHash = params.get('token_hash');
  return {
    code: code && code.trim() ? code : null,
    tokenHash: tokenHash && tokenHash.trim() ? tokenHash : null,
  };
}

/**
 * Copy `code` / `token_hash` into memory, then strip them (and companion `type`)
 * from the address bar before any exchange is awaited.
 */
export function takeAuthSecretsAndStripAddressBar(): {
  code: string | null;
  tokenHash: string | null;
} {
  if (typeof window === 'undefined') {
    return { code: null, tokenHash: null };
  }
  const secrets = readAuthSecretsFromSearch(window.location.search);
  stripSensitiveParamsFromAddressBar();
  return secrets;
}
