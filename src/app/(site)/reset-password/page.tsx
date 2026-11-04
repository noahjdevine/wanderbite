import { redirect } from 'next/navigation';
import { resetPasswordGate } from '@/lib/auth/reset-password-gate';
import { createClient } from '@/lib/supabase/server';
import { ResetPasswordForm } from './reset-password-form';
import { ResetPasswordHashFallback } from './reset-password-hash-fallback';
import { ResetPasswordInvalid } from './reset-password-invalid';

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function InvalidResetLink() {
  return (
    <>
      <ResetPasswordInvalid />
      <ResetPasswordHashFallback />
    </>
  );
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{
    code?: string | string[];
    token_hash?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const gate = resetPasswordGate({
    hasSession: Boolean(user),
    code: firstParam(params.code),
    tokenHash: firstParam(params.token_hash),
  });

  if (gate.type === 'redirect') redirect(gate.to);
  if (gate.type === 'invalid') return <InvalidResetLink />;
  return (
    <>
      <ResetPasswordForm />
      <ResetPasswordHashFallback />
    </>
  );
}
