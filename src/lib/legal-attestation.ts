/** Terms and Privacy sources pinned for this attestation. Do not bump one side alone. */
export const LEGAL_DOCUMENT_VERSION = '2026-02-22';

/** SHA-256 of terms/page.tsx and privacy/page.tsx, as specified for this version. */
export const LEGAL_CONTENT_ID =
  '53e3148013cc72dd9c0f7856fc2dd2bf6d4b870e89fdcd59fe0ee5073b3de1fb';

export const LEGAL_ATTESTATION_REQUIRED_MESSAGE =
  'Confirm you are 21 or older and agree to the current terms before checkout.';

export const ATTESTATION_AFTER_SIGN_IN_MESSAGE =
  "We'll ask you to confirm you are 21 or older and agree to the current terms after you sign in.";

export const ATTESTATION_CONFIRM_MESSAGE =
  'Confirm you are 21 or older and agree to the terms.';

export type SignupAttestationDecision = 'record' | 'mismatch' | 'no-session';

/**
 * Signup may record only when the session user is the user that signup returned.
 * No session is not a mismatch: confirmation email can leave the account unsigned-in.
 */
export function signupAttestationDecision(
  signedUpUserId: string | null | undefined,
  sessionUserId: string | null | undefined,
): SignupAttestationDecision {
  if (!sessionUserId) return 'no-session';
  if (!signedUpUserId || sessionUserId !== signedUpUserId) return 'mismatch';
  return 'record';
}
