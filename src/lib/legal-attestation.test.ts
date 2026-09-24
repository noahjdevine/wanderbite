import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEGAL_CONTENT_ID,
  LEGAL_DOCUMENT_VERSION,
  signupAttestationDecision,
} from '@/lib/legal-attestation';

const ROOT = path.resolve(__dirname, '../..');

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function pinnedContentId(): string {
  const terms = readFileSync(path.join(ROOT, 'src/app/(site)/terms/page.tsx'));
  const privacy = readFileSync(path.join(ROOT, 'src/app/(site)/privacy/page.tsx'));
  const hash = createHash('sha256');
  hash.update('terms/page.tsx');
  hash.update('\n');
  hash.update(terms);
  hash.update('\n');
  hash.update('privacy/page.tsx');
  hash.update('\n');
  hash.update(privacy);
  return hash.digest('hex');
}

describe('G17-A legal attestation', () => {
  it('pins the same version and content id in the app and the function', () => {
    const migration = source('supabase/migrations/20260924001538_g17_a_legal_attestations.sql');
    const fresh = pinnedContentId();
    expect(fresh).toBe(LEGAL_CONTENT_ID);
    expect(LEGAL_DOCUMENT_VERSION).toBe('2026-02-22');
    expect(migration).toContain(`v_version constant text := '${LEGAL_DOCUMENT_VERSION}'`);
    expect(migration).toContain(`v_content_id constant text := '${LEGAL_CONTENT_ID}'`);
    expect(migration).toContain('No backfill');
  });

  it('records signup attestation only for the user that signup returned', () => {
    const user = '17000000-0000-4000-8000-000000000001';
    const other = '17000000-0000-4000-8000-000000000002';
    expect(signupAttestationDecision(user, user)).toBe('record');
    expect(signupAttestationDecision(user, other)).toBe('mismatch');
    expect(signupAttestationDecision(user, null)).toBe('no-session');
    expect(signupAttestationDecision(null, user)).toBe('mismatch');
    expect(signupAttestationDecision(null, null)).toBe('no-session');

    const signup = source('src/app/(site)/signup/page.tsx');
    expect(signup).toContain('I confirm I am 21 or older.');
    expect(signup).toContain(`Terms and Privacy version {LEGAL_DOCUMENT_VERSION}`);
    expect(signup).not.toContain('preferences screen');
    expect(signup).not.toContain('localStorage');
    expect(signup).not.toMatch(/sessionStorage\.setItem\((?!PENDING_EMAIL_KEY)/);

    const signupAction = source('src/app/actions/credential-sign-up.ts');
    expect(signupAction).toContain('signupAttestationDecision');
    expect(signupAction).toContain('attestation=after-sign-in');
    expect(signupAction).toContain('getEmailConfirmCallbackUrl');
    expect(signupAction).not.toContain('window.location.origin');

    const checkEmail = source('src/app/(site)/signup/check-email/page.tsx');
    expect(checkEmail).toContain('ATTESTATION_AFTER_SIGN_IN_MESSAGE');
    expect(checkEmail).not.toContain('recordLegalAttestation');
    expect(checkEmail).not.toContain('localStorage');
  });

  it('uses the account-switch check on account and onboarding and not on preference saves', () => {
    expect(source('src/components/account/AccountClient.tsx')).toContain(
      'renderedForUserId={initial.userId}',
    );
    expect(source('src/components/onboarding/OnboardingWizard.tsx')).toContain(
      'renderedForUserId={initial.userId}',
    );
    for (const rel of [
      'src/app/actions/onboarding.ts',
      'src/app/actions/update-preferences.ts',
      'src/components/forms/PreferencesForm.tsx',
    ]) {
      expect(source(rel), rel).not.toMatch(/legal_attestations|recordLegalAttestation|record_legal_attestation/);
    }
  });

  it('keeps challenges, roulette, and the billing portal off the attestation table', () => {
    for (const rel of [
      'src/app/(site)/challenges/page.tsx',
      'src/app/api/roulette/route.ts',
      'src/app/(site)/billing/manage-subscription-button.tsx',
    ]) {
      expect(source(rel), rel).not.toMatch(/legal_attestations|record_legal_attestation/);
    }
    const stripe = source('src/app/actions/stripe.ts');
    const portalAt = stripe.indexOf('export async function createBillingPortalSession');
    expect(stripe.slice(0, portalAt)).toMatch(/legal_attestations/);
    expect(stripe.slice(portalAt)).not.toMatch(/legal_attestations/);
    expect(stripe).not.toMatch(/ATTESTATION_SKIP|SKIP_ATTESTATION/);
  });

  it('leaves profile grants and AI ceilings untouched', () => {
    const grants = source('supabase/migrations/20260906012137_user_profiles_privilege_grants.sql');
    expect(grants).toContain('wants_cocktail_experience');
    expect(grants).not.toContain('legal_attestations');
    const budget = source('supabase/migrations/20260919172836_ai_budget_reservations.sql');
    expect(budget).toMatch(/1000000,\s+200000,/);
  });
});
