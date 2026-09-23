/**
 * Admin TOTP helpers. Production MFA has no bypass.
 * Lost-factor deletion is operator-side; see Docs/g14-admin-mfa-runbook.md.
 */

export const ADMIN_MFA_RETURN_PATH = '/admin';

export const ADMIN_MFA_ISSUER = 'Wanderbite';

export const ADMIN_MFA_FRIENDLY_NAME = 'Wanderbite admin';

/**
 * Always false. An env flag, query parameter, or shared secret must not
 * skip admin MFA. Arguments are accepted so callers can pass request
 * material without it ever granting access.
 */
export function adminMfaBypassGranted(request?: {
  envFlag?: string | null;
  query?: string | null;
  sharedSecret?: string | null;
}): false {
  void request?.envFlag;
  void request?.query;
  void request?.sharedSecret;
  return false;
}

export function normalizeTotpCode(raw: string): string | null {
  const code = raw.trim().replace(/\s+/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

export function isUnverifiedTotpFactor(factor: {
  factor_type: string;
  status: string;
}): boolean {
  return factor.factor_type === 'totp' && factor.status === 'unverified';
}

export function isVerifiedTotpFactor(factor: {
  factor_type: string;
  status: string;
}): boolean {
  return factor.factor_type === 'totp' && factor.status === 'verified';
}

/**
 * supabase-js prepends this prefix itself. Keep a raw SVG usable in <img>.
 * Do not log the value.
 */
export function totpQrImageSrc(qrCode: string): string {
  const trimmed = qrCode.trim();
  if (trimmed.startsWith('data:image/')) return trimmed;
  return `data:image/svg+xml;utf-8,${trimmed}`;
}
