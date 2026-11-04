'use client';

import { Suspense, useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AuthScreen } from '@/components/auth/auth-screen';
import { ATTESTATION_AFTER_SIGN_IN_MESSAGE } from '@/lib/legal-attestation';

const PENDING_EMAIL_KEY = 'wanderbite_pending_signup_email';
const RESEND_COOLDOWN_MS = 60_000;

function readPendingSignupEmail(): string | null {
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
}

function subscribePendingSignupEmail(_onStoreChange: () => void) {
  return () => {};
}

function pendingSignupEmailServerSnapshot(): null {
  return null;
}

function CheckEmailContent() {
  const searchParams = useSearchParams();
  const showAttestationLater = searchParams.get('attestation') === 'after-sign-in';
  const email = useSyncExternalStore(
    subscribePendingSignupEmail,
    readPendingSignupEmail,
    pendingSignupEmailServerSnapshot,
  );
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [resendErr, setResendErr] = useState<string | null>(null);

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
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
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
    <AuthScreen
      marker={
        <div className="wb-auth-mail" aria-hidden="true">
          <Mail className="size-7" />
        </div>
      }
      title="Check your email."
      lede={
        email ? (
          <>
            We sent a confirmation link to <span className="wb-auth-email">{email}</span>. Tap it to
            unlock your first challenge.
          </>
        ) : (
          <>We sent a confirmation link. Open it on this device to keep going.</>
        )
      }
    >
      <div className="wb-auth-form">
        {showAttestationLater ? (
          <Alert className="wb-auth-alert">
            <AlertTitle>Confirmation still needed</AlertTitle>
            <AlertDescription>{ATTESTATION_AFTER_SIGN_IN_MESSAGE}</AlertDescription>
          </Alert>
        ) : null}

        {!email ? (
          <Alert className="wb-auth-alert">
            <AlertTitle>Wrong device?</AlertTitle>
            <AlertDescription>
              Open the email on the phone or computer where you signed up, or{' '}
              <Link href="/signup" className="wb-auth-link">
                start again with a different email
              </Link>
              .
            </AlertDescription>
          </Alert>
        ) : null}

        {resendErr ? (
          <Alert className="wb-auth-alert wb-auth-alert-error">
            <AlertTitle>Resend didn&apos;t go through</AlertTitle>
            <AlertDescription>{resendErr}</AlertDescription>
          </Alert>
        ) : null}
        {resendMsg ? (
          <Alert className="wb-auth-alert wb-auth-alert-ok">
            <AlertTitle>Sent</AlertTitle>
            <AlertDescription>{resendMsg}</AlertDescription>
          </Alert>
        ) : null}

        <button
          type="button"
          className="wb-auth-submit"
          disabled={!email || resendBusy || cooldownLeft > 0}
          onClick={() => void resend()}
        >
          {resendBusy ? (
            <>
              <Loader2 className="size-4 animate-spin wb-auth-spinner" aria-hidden />
              Sending…
            </>
          ) : cooldownLeft > 0 ? (
            `Resend available in ${cooldownLeft}s`
          ) : (
            "Didn't get it? Resend confirmation"
          )}
        </button>

        <p className="wb-auth-muted text-center">
          Wrong email?{' '}
          <Link href="/signup" className="wb-auth-link">
            Use a different one
          </Link>
        </p>

        <p className="text-center">
          <Link href="/signin" className="wb-auth-link">
            Back to sign in
          </Link>
        </p>
      </div>
    </AuthScreen>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense
      fallback={
        <AuthScreen title="Check your email.">
          <Loader2 className="mx-auto size-8 animate-spin wb-auth-spinner" aria-hidden />
        </AuthScreen>
      }
    >
      <CheckEmailContent />
    </Suspense>
  );
}
