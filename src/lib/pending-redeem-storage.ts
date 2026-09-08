import { stripSensitiveParamsFromAddressBar } from '@/lib/sensitive-url';

export const PENDING_REDEEM_TTL_MS = 10 * 60 * 1000;
export const PENDING_REDEEM_VERSION = 1;

export function pendingRedeemStorageKey(slug: string): string {
  return `wanderbite:pending-redeem:${slug}`;
}

export type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type PendingRedeemRecord = {
  v: typeof PENDING_REDEEM_VERSION;
  code: string;
  exp: number;
};

function defaultStorage(): SessionStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function parseRecord(raw: string | null): PendingRedeemRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const rec = parsed as Partial<PendingRedeemRecord>;
    if (rec.v !== PENDING_REDEEM_VERSION) return null;
    if (typeof rec.code !== 'string' || !rec.code.trim()) return null;
    if (typeof rec.exp !== 'number' || !Number.isFinite(rec.exp)) return null;
    return { v: PENDING_REDEEM_VERSION, code: rec.code.trim().toUpperCase(), exp: rec.exp };
  } catch {
    return null;
  }
}

export function writePendingRedeemCode(
  slug: string,
  code: string,
  options?: { now?: number; storage?: SessionStorageLike | null; ttlMs?: number },
): boolean {
  const trimmed = code.trim().toUpperCase();
  if (!slug || !trimmed) return false;
  const storage = options?.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return false;
  const now = options?.now ?? Date.now();
  const ttlMs = options?.ttlMs ?? PENDING_REDEEM_TTL_MS;
  const record: PendingRedeemRecord = {
    v: PENDING_REDEEM_VERSION,
    code: trimmed,
    exp: now + ttlMs,
  };
  try {
    storage.setItem(pendingRedeemStorageKey(slug), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function consumePendingRedeemCode(
  slug: string,
  options?: { now?: number; storage?: SessionStorageLike | null },
): string | null {
  const storage = options?.storage === undefined ? defaultStorage() : options.storage;
  if (!storage || !slug) return null;
  const key = pendingRedeemStorageKey(slug);
  try {
    const parsed = parseRecord(storage.getItem(key));
    storage.removeItem(key);
    if (!parsed) return null;
    const now = options?.now ?? Date.now();
    if (parsed.exp <= now) return null;
    return parsed.code;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/**
 * Copy a scan code into slug-scoped sessionStorage, then strip `code` from the
 * address bar. Storage failure must not put the code back on the URL.
 */
export function persistAndStripPartnerRedeemCode(
  slug: string,
  codeFromUrl: string | null | undefined,
  options?: { storage?: SessionStorageLike | null; now?: number },
): void {
  const code = codeFromUrl?.trim();
  if (code) {
    writePendingRedeemCode(slug, code, options);
  }
  stripSensitiveParamsFromAddressBar();
}

/** One-use read: storage is removed before the caller verifies. */
export function takePartnerRedeemCodeForVerify(
  slug: string,
  initialCode?: string | null,
  options?: { storage?: SessionStorageLike | null; now?: number },
): string | null {
  const stored = consumePendingRedeemCode(slug, options);
  const fromInitial = initialCode?.trim();
  if (fromInitial) return fromInitial.toUpperCase();
  return stored;
}
