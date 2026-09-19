export const PASSWORD_RESET_VALIDATION_MESSAGE =
  'Please enter a valid email address.';

export const PASSWORD_RESET_UNAVAILABLE_MESSAGE =
  'Unable to send a reset email right now. Please try again later.';

export const PASSWORD_RESET_RECOVERY_PATH = '/auth/recovery';

const MAX_EMAIL_CHARS = 254;

/** Conservative local@domain check. Not a full RFC 5322 parser. */
export function parseResetEmail(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized.length > MAX_EMAIL_CHARS) return null;
  if (normalized.includes('..') || normalized.includes(' ')) return null;
  const at = normalized.indexOf('@');
  if (at <= 0 || at !== normalized.lastIndexOf('@')) return null;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (!local || !domain || !domain.includes('.')) return null;
  if (local.length > 64) return null;
  if (!/^[a-z0-9._%+-]+$/i.test(local)) return null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  return normalized;
}

export function isPasswordResetDisabled(
  value: string | undefined = process.env.WANDERBITE_PASSWORD_RESET_DISABLED,
): boolean {
  return value === 'true';
}

export function passwordResetRecoveryUrl(
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
  baseUrl: string | undefined = process.env.NEXT_PUBLIC_BASE_URL,
): string | null {
  const raw = siteUrl?.trim() || baseUrl?.trim() || '';
  if (!raw) return null;
  try {
    const origin = new URL(raw);
    if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return null;
    if (!origin.host) return null;
    return `${origin.origin}${PASSWORD_RESET_RECOVERY_PATH}`;
  } catch {
    return null;
  }
}
