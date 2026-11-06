/**
 * Private receipt storage limits for E07-B2.
 * These clocks and caps are not the 15-minute QR TTL, the 840-hour visit
 * deadline, or credit expiry.
 */

/** Private bucket. Not `restaurant-photos`. */
export const RECEIPT_BUCKET = 'bill-receipts';

/**
 * 10 MB decimal cap (10_000_000 bytes), inclusive.
 * `restaurant-photos` stays 5 MiB and is not a receipt limit.
 */
export const RECEIPT_MAX_BYTES = 10_000_000;

/** Longest side, inclusive. Larger images are refused. They are not downscaled. */
export const RECEIPT_MAX_EDGE_PX = 8000;

/** Server-minted signed URL lifetime. The member client does not receive the object. */
export const RECEIPT_SIGNED_URL_TTL_SECONDS = 5 * 60;

/** Default raw-receipt retention. Override with `E07_RECEIPT_RETAIN_DAYS`. */
export const RECEIPT_RETAIN_DAYS_DEFAULT = 7;

/** Upper bound for a configured retention interval. Ten years. */
export const RECEIPT_RETAIN_DAYS_MAX = 3660;

export const RECEIPT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export type ReceiptContentType = (typeof RECEIPT_CONTENT_TYPES)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isReceiptContentType(value: string): value is ReceiptContentType {
  return (RECEIPT_CONTENT_TYPES as readonly string[]).includes(value);
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** `{user_id}/{id}`. Both segments are lowercase uuids. */
export function receiptObjectPath(userId: string, id: string): string | null {
  if (!isUuid(userId) || !isUuid(id)) return null;
  return `${userId}/${id}`;
}

export function isReceiptObjectPath(objectPath: string): boolean {
  const slash = objectPath.indexOf('/');
  if (slash <= 0 || objectPath.indexOf('/', slash + 1) !== -1) return false;
  return isUuid(objectPath.slice(0, slash)) && isUuid(objectPath.slice(slash + 1));
}

/**
 * Blank or omitted uses the 7-day default.
 * Any other value must be a positive integer within the documented max.
 * Returns null when the setting is invalid. Callers refuse the upload.
 */
export function receiptRetainDays(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return RECEIPT_RETAIN_DAYS_DEFAULT;
  if (!/^[1-9]\d*$/.test(value.trim())) return null;
  const days = Number(value.trim());
  if (!Number.isSafeInteger(days) || days < 1 || days > RECEIPT_RETAIN_DAYS_MAX) return null;
  return days;
}
