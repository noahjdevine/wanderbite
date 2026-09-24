import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_CHANGED_MESSAGE } from '@/lib/auth/account-changed';
import { ATTESTATION_CONFIRM_MESSAGE, LEGAL_DOCUMENT_VERSION } from '@/lib/legal-attestation';

const requireUser = vi.fn();
const rpc = vi.fn();

vi.mock('@/lib/auth/require-user', () => ({
  requireUser: () => requireUser(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}));

import { recordLegalAttestation } from '@/app/actions/legal-attestation';

const USER = '17000000-0000-4000-8000-000000000001';
const OTHER = '17000000-0000-4000-8000-000000000002';

describe('recordLegalAttestation', () => {
  beforeEach(() => {
    requireUser.mockReset();
    rpc.mockReset();
    requireUser.mockResolvedValue({ ok: true, userId: USER, email: 'member@example.com' });
    rpc.mockResolvedValue({ error: null });
  });

  it('forwards the presented version for the rendered account and does not send an identity', async () => {
    const saved = await recordLegalAttestation(
      {
        presentedVersion: LEGAL_DOCUMENT_VERSION,
        age21: true,
        agreeToTerms: true,
      },
      USER,
    );
    expect(saved).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('record_legal_attestation', {
      p_presented_version: LEGAL_DOCUMENT_VERSION,
      p_age_21: true,
      p_agree_to_terms: true,
    });
  });

  it('writes nothing when the rendered account is not the session user', async () => {
    const switched = await recordLegalAttestation(
      {
        presentedVersion: LEGAL_DOCUMENT_VERSION,
        age21: true,
        agreeToTerms: true,
      },
      OTHER,
    );
    expect(switched).toEqual({ ok: false, error: ACCOUNT_CHANGED_MESSAGE });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('writes nothing when either confirmation is missing', async () => {
    const missingAge = await recordLegalAttestation(
      { presentedVersion: LEGAL_DOCUMENT_VERSION, age21: false, agreeToTerms: true },
      USER,
    );
    const missingTerms = await recordLegalAttestation(
      { presentedVersion: LEGAL_DOCUMENT_VERSION, age21: true, agreeToTerms: false },
      USER,
    );
    expect(missingAge).toEqual({ ok: false, error: ATTESTATION_CONFIRM_MESSAGE });
    expect(missingTerms).toEqual({ ok: false, error: ATTESTATION_CONFIRM_MESSAGE });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes a different presented version through and does not rewrite it', async () => {
    await recordLegalAttestation(
      { presentedVersion: '1999-01-01', age21: true, agreeToTerms: true },
      USER,
    );
    expect(rpc).toHaveBeenCalledWith('record_legal_attestation', {
      p_presented_version: '1999-01-01',
      p_age_21: true,
      p_agree_to_terms: true,
    });
  });
});
