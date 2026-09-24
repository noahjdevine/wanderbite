import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { resetPasswordGate } from '@/lib/auth/reset-password-gate';
import { createClient } from '@/lib/supabase/server';
import { ResetPasswordForm } from './reset-password-form';
import { ResetPasswordHashFallback } from './reset-password-hash-fallback';

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function InvalidResetLink() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Invalid or expired link</CardTitle>
          <CardDescription>
            This reset link may have expired. Request a new one from the login page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/forgot-password">Request new reset link</Link>
          </Button>
        </CardContent>
      </Card>
      <ResetPasswordHashFallback />
    </main>
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
