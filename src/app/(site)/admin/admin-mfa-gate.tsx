'use client';

import { useEffect, useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  beginAdminMfaEnrollment,
  verifyAdminMfaChallenge,
  verifyAdminMfaEnrollment,
} from './mfa-actions';

const inputClassName =
  'w-full rounded-md border border-input bg-background px-3 py-2.5 text-base tracking-widest sm:text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20';

function LostFactorNotice() {
  return (
    <p className="text-sm text-muted-foreground">
      Lost your authenticator? There is no way to skip this check. An operator
      must verify your identity and write an audit record before deleting the
      factor. Deleting a verified factor signs out every active session.
    </p>
  );
}

export function AdminMfaGate({ mode }: { mode: 'enroll' | 'challenge' }) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (mode !== 'enroll') return;
    let cancelled = false;
    void (async () => {
      const result = await beginAdminMfaEnrollment();
      if (cancelled) return;
      if (!result.ok) {
        setSetupError(result.error);
        return;
      }
      setFactorId(result.factorId);
      setQrCode(result.qrCode);
      setSecret(result.secret);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  function onSubmit(formData: FormData) {
    const code = String(formData.get('code') ?? '');
    setError(null);
    startTransition(async () => {
      const result =
        mode === 'enroll'
          ? await verifyAdminMfaEnrollment(factorId ?? '', code)
          : await verifyAdminMfaChallenge(code);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {mode === 'enroll' ? 'Set up your authenticator' : 'Verify your authenticator'}
        </CardTitle>
        <CardDescription>
          {mode === 'enroll'
            ? 'Admin tools stay locked until this authenticator is verified. You will return to the admin page after the code is accepted.'
            : 'This sign-in is not finished until you enter the current authenticator code. You will return to the admin page after it is accepted.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === 'enroll' && setupError ? (
          <Alert variant="destructive">
            <AlertDescription>{setupError}</AlertDescription>
          </Alert>
        ) : null}

        {mode === 'enroll' && !setupError && !qrCode ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Preparing authenticator setup…
          </p>
        ) : null}

        {mode === 'enroll' && qrCode && secret ? (
          <div className="space-y-3">
            <img
              src={qrCode}
              alt="Authenticator QR code"
              className="h-40 w-40 rounded-md border bg-white p-2"
            />
            <div className="space-y-1">
              <p className="text-sm font-medium">Or enter this secret manually</p>
              <p className="break-all font-mono text-sm">{secret}</p>
            </div>
          </div>
        ) : null}

        <form action={onSubmit} className="space-y-3">
          <div className="space-y-2">
            <label htmlFor="admin-mfa-code" className="text-sm font-medium">
              6-digit code
            </label>
            <input
              id="admin-mfa-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              className={inputClassName}
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" disabled={pending || (mode === 'enroll' && !factorId)}>
            {pending ? 'Checking…' : mode === 'enroll' ? 'Enable and continue' : 'Continue'}
          </Button>
        </form>
        <LostFactorNotice />
      </CardContent>
    </Card>
  );
}
