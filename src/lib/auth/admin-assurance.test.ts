import { describe, expect, it } from 'vitest';
import { adminPageDecision, decideAdminAssurance } from '@/lib/auth/admin-assurance';

describe('decideAdminAssurance', () => {
  it('requires currentLevel aal2 and ignores an enrolled-but-unchallenged session', () => {
    expect(
      decideAdminAssurance({ currentLevel: 'aal2', nextLevel: 'aal2' }),
    ).toEqual({ ok: true });
    expect(
      decideAdminAssurance({ currentLevel: 'aal2', nextLevel: 'aal1' }),
    ).toEqual({ ok: true });
    expect(
      decideAdminAssurance({ currentLevel: 'aal1', nextLevel: 'aal2' }),
    ).toEqual({ ok: false, code: 'mfa_challenge' });
  });

  it('sends an admin with no factor to enrollment', () => {
    expect(
      decideAdminAssurance({ currentLevel: 'aal1', nextLevel: 'aal1' }),
    ).toEqual({ ok: false, code: 'mfa_enroll' });
  });

  it('fails closed on Auth errors and unexpected levels', () => {
    expect(decideAdminAssurance(null)).toEqual({ ok: false, code: 'auth_error' });
    expect(
      decideAdminAssurance({ currentLevel: null, nextLevel: 'aal2' }),
    ).toEqual({ ok: false, code: 'auth_error' });
    expect(
      decideAdminAssurance({ currentLevel: 'aal1', nextLevel: null }),
    ).toEqual({ ok: false, code: 'auth_error' });
    expect(
      decideAdminAssurance({ currentLevel: 'aal3', nextLevel: 'aal2' }),
    ).toEqual({ ok: false, code: 'auth_error' });
  });
});

describe('adminPageDecision', () => {
  it('keeps dashboard data behind a successful assert', () => {
    expect(adminPageDecision({ ok: true })).toEqual({ kind: 'dashboard' });
  });

  it('shows enrollment or challenge without treating them as dashboard access', () => {
    expect(adminPageDecision({ ok: false, code: 'mfa_enroll' })).toEqual({
      kind: 'mfa',
      mode: 'enroll',
    });
    expect(adminPageDecision({ ok: false, code: 'mfa_challenge' })).toEqual({
      kind: 'mfa',
      mode: 'challenge',
    });
  });

  it('sends Auth failures away from admin data and away from enrollment', () => {
    expect(adminPageDecision({ ok: false, code: 'unauthenticated' })).toEqual({
      kind: 'redirect',
      href: '/signin?redirectTo=/admin',
    });
    for (const code of ['not_admin', 'role_lookup_failed', 'auth_error'] as const) {
      expect(adminPageDecision({ ok: false, code })).toEqual({
        kind: 'redirect',
        href: '/challenges',
      });
    }
  });
});
