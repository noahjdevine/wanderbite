'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Loader2, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getEmailConfirmCallbackUrl } from '@/lib/auth/safe-redirect';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const PENDING_EMAIL_KEY = 'wanderbite_pending_signup_email';
const RESEND_COOLDOWN_MS = 60_000;

export default function CheckEmailPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resendErr, setResendErr] = useState<string | null>(null);

  useEffect(() => {
    try {
      const v = sessionStorage.getItem(PENDING_EMAIL_KEY);
      setEmail(v);
    } catch {
      setEmail(null);
    }
  }, []);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = setInterval(() => {
      setCooldownLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownLeft]);

  const resend = useCallback(async () => {
    if (!email?.trim() || cooldownLeft > 0) return;
    setResendBusy(true);
    setResendErr(null);
    setResendMsg(null);
    try {
      const supabase = createClient();
      const redirectUrl = getEmailConfirmCallbackUrl(window.location.origin);
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: redirectUrl },
      });
      if (error) {
        setResendErr(error.message);
        return;
      }
      setResendMsg('Another confirmation is on its way.');
      setCooldownLeft(Math.ceil(RESEND_COOLDOWN_MS / 1000));
    } catch {
      setResendErr('Could not resend. Try again in a moment.');
    } finally {
      setResendBusy(false);
    }
  }, [email, cooldownLeft]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm border-violet-200/60 shadow-md">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Mail className="size-7" aria-hidden />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Check your email.</CardTitle>
          <CardDescription className="text-base">
            {email ? (
              <>
                We sent a confirmation link to{' '}
                <span className="font-medium text-foreground">{email}</span>. Tap it to unlock your first
                challenge.
              </>
            ) : (
              <>We sent a confirmation link. Open it on this device to keep going.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!email ? (
            <Alert>
              <AlertTitle>Wrong device?</AlertTitle>
              <AlertDescription>
                Open the email on the phone or computer where you signed up, or{' '}
                <Link href="/signup" className="font-medium text-primary underline-offset-2 hover:underline">
                  start again with a different email
                </Link>
                .
              </AlertDescription>
            </Alert>
          ) : null}

          {resendErr ? (
            <Alert variant="destructive">
              <AlertTitle>Resend didn&apos;t go through</AlertTitle>
              <AlertDescription>{resendErr}</AlertDescription>
            </Alert>
          ) : null}
          {resendMsg ? (
            <Alert className="border-primary/30 bg-primary/5">
              <AlertTitle>Sent</AlertTitle>
              <AlertDescription>{resendMsg}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            disabled={!email || resendBusy || cooldownLeft > 0}
            onClick={() => void resend()}
          >
            {resendBusy ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                Sending…
              </>
            ) : cooldownLeft > 0 ? (
              `Resend available in ${cooldownLeft}s`
            ) : (
              "Didn't get it? Resend confirmation"
            )}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Wrong email?{' '}
            <Link href="/signup" className="font-medium text-primary underline-offset-2 hover:underline">
              Use a different one
            </Link>
          </p>

          <p className="text-center text-sm">
            <Link href="/signin" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
