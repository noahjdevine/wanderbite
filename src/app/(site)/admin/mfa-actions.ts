'use server';

import { redirect } from 'next/navigation';
import { assertAdminRole } from '@/lib/auth/assert-admin';
import {
  ADMIN_MFA_FRIENDLY_NAME,
  ADMIN_MFA_ISSUER,
  ADMIN_MFA_RETURN_PATH,
  isUnverifiedTotpFactor,
  isVerifiedTotpFactor,
  normalizeTotpCode,
  totpQrImageSrc,
} from '@/lib/auth/admin-mfa';
import { createClient } from '@/lib/supabase/server';
import { parseUuid } from '@/lib/uuid';

type MfaFailure = { ok: false; error: string };

type ListedFactor = {
  id: string;
  factor_type: string;
  status: string;
};

const SETUP_FAILED = 'Could not start authenticator setup.';
const VERIFY_FAILED = 'That code was not accepted. Try the current code from your authenticator app.';
const FACTORS_FAILED = 'Failed to check authenticator factors.';
const ALREADY_ENROLLED =
  'An authenticator is already enrolled. Enter the current code to continue.';
const CODE_INVALID = 'Enter the 6-digit code from your authenticator app.';

async function sessionMfa() {
  const supabase = await createClient();
  return supabase.auth.mfa;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toFactor(item: unknown): ListedFactor | null {
  if (!item || typeof item !== 'object') return null;
  const row = item as { id?: unknown; factor_type?: unknown; status?: unknown };
  if (typeof row.id !== 'string' || typeof row.factor_type !== 'string') return null;
  if (row.status !== 'verified' && row.status !== 'unverified') return null;
  return { id: row.id, factor_type: row.factor_type, status: row.status };
}

function readFactors(value: unknown): ListedFactor[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as { all?: unknown; totp?: unknown };
  const factors: ListedFactor[] = [];
  for (const item of [...asArray(record.all), ...asArray(record.totp)]) {
    const factor = toFactor(item);
    if (!factor || factors.some((existing) => existing.id === factor.id)) continue;
    factors.push(factor);
  }
  return factors;
}

/**
 * Role-checked TOTP enrollment for an admin who has no verified factor.
 * Does not read restaurants, user emails, or audit rows, and does not
 * call dashboard mutations. Refuses when a verified factor already exists
 * so an AAL1 session cannot replace it.
 */
export async function beginAdminMfaEnrollment(): Promise<
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | MfaFailure
> {
  const role = await assertAdminRole();
  if (!role.ok) return { ok: false, error: role.error };

  try {
    const mfa = await sessionMfa();
    const listed = await mfa.listFactors();
    if (listed.error) return { ok: false, error: FACTORS_FAILED };

    const factors = readFactors(listed.data);
    if (factors.some(isVerifiedTotpFactor)) {
      return { ok: false, error: ALREADY_ENROLLED };
    }

    for (const factor of factors) {
      if (!isUnverifiedTotpFactor(factor)) continue;
      const cleared = await mfa.unenroll({ factorId: factor.id });
      if (cleared.error) return { ok: false, error: SETUP_FAILED };
    }

    const enrolled = await mfa.enroll({
      factorType: 'totp',
      friendlyName: ADMIN_MFA_FRIENDLY_NAME,
      issuer: ADMIN_MFA_ISSUER,
    });
    if (enrolled.error || enrolled.data.type !== 'totp') {
      return { ok: false, error: SETUP_FAILED };
    }

    return {
      ok: true,
      factorId: enrolled.data.id,
      qrCode: totpQrImageSrc(enrolled.data.totp.qr_code),
      secret: enrolled.data.totp.secret,
    };
  } catch {
    return { ok: false, error: SETUP_FAILED };
  }
}

async function verifyFactor(factorId: string, code: string): Promise<MfaFailure | { ok: true }> {
  const mfa = await sessionMfa();
  const challenge = await mfa.challenge({ factorId });
  if (challenge.error || !challenge.data?.id) {
    return { ok: false, error: VERIFY_FAILED };
  }

  const verified = await mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  });
  if (verified.error) return { ok: false, error: VERIFY_FAILED };
  return { ok: true };
}

/**
 * Completes first-time enrollment, then returns the admin to /admin.
 * Refuses if a verified factor already exists.
 */
export async function verifyAdminMfaEnrollment(
  factorId: string,
  code: string,
): Promise<MfaFailure> {
  const role = await assertAdminRole();
  if (!role.ok) return { ok: false, error: role.error };

  const id = parseUuid(factorId);
  const normalized = normalizeTotpCode(code);
  if (!id || !normalized) return { ok: false, error: CODE_INVALID };

  try {
    const mfa = await sessionMfa();
    const listed = await mfa.listFactors();
    if (listed.error) return { ok: false, error: FACTORS_FAILED };

    const factors = readFactors(listed.data);
    if (factors.some(isVerifiedTotpFactor)) {
      return { ok: false, error: ALREADY_ENROLLED };
    }
    const target = factors.find((factor) => factor.id === id);
    if (!target || !isUnverifiedTotpFactor(target)) {
      return { ok: false, error: SETUP_FAILED };
    }

    const result = await verifyFactor(id, normalized);
    if (!result.ok) return result;
  } catch {
    return { ok: false, error: VERIFY_FAILED };
  }

  redirect(ADMIN_MFA_RETURN_PATH);
}

/**
 * Sign-in challenge for an admin who already has a verified factor.
 * Returns to /admin only after this session's challenge succeeds.
 */
export async function verifyAdminMfaChallenge(code: string): Promise<MfaFailure> {
  const role = await assertAdminRole();
  if (!role.ok) return { ok: false, error: role.error };

  const normalized = normalizeTotpCode(code);
  if (!normalized) return { ok: false, error: CODE_INVALID };

  try {
    const mfa = await sessionMfa();
    const listed = await mfa.listFactors();
    if (listed.error) return { ok: false, error: FACTORS_FAILED };

    const verifiedFactor = readFactors(listed.data).find(isVerifiedTotpFactor);
    if (!verifiedFactor) return { ok: false, error: FACTORS_FAILED };

    const result = await verifyFactor(verifiedFactor.id, normalized);
    if (!result.ok) return result;
  } catch {
    return { ok: false, error: VERIFY_FAILED };
  }

  redirect(ADMIN_MFA_RETURN_PATH);
}
