export type ResetPasswordGate =
  | { type: 'form' }
  | { type: 'invalid' }
  | { type: 'redirect'; to: string };

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Query secrets on /reset-password are exchanged by /auth/recovery.
 * A session that already exists is not sent through that exchange again.
 */
export function resetPasswordGate(input: {
  hasSession: boolean;
  code: string | null;
  tokenHash: string | null;
}): ResetPasswordGate {
  const code = present(input.code);
  const tokenHash = present(input.tokenHash);
  const hasSecret = Boolean(code || tokenHash);

  if (input.hasSession && hasSecret) {
    return { type: 'redirect', to: '/reset-password' };
  }
  if (input.hasSession) {
    return { type: 'form' };
  }
  if (hasSecret) {
    const query = new URLSearchParams();
    if (code) query.set('code', code);
    if (tokenHash) query.set('token_hash', tokenHash);
    return { type: 'redirect', to: `/auth/recovery?${query.toString()}` };
  }
  return { type: 'invalid' };
}
