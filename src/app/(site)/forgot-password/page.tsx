'use client';

import { Suspense, useActionState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AuthScreen } from '@/components/auth/auth-screen';
import { sendPasswordResetFromForm } from '@/app/actions/credential-password';

const EXPIRED_RESET_LINK_MESSAGE =
  'That reset link expired or was opened in a different browser. Request a new one and open it in this same browser.';

function ForgotPasswordRequest({ linkExpired }: { linkExpired: boolean }) {
  const [state, formAction, isLoading] = useActionState(sendPasswordResetFromForm, null);
  const sent = state?.ok === true;
  const error = state && !state.ok ? state.error : null;

  return (
    <AuthScreen
      title="Forgot it? Happens to the best of us."
      lede="Drop your email below and we'll send a reset link if an account exists for it."
    >
      {sent ? (
        <div className="wb-auth-form">
          <Alert className="wb-auth-alert wb-auth-alert-ok">
            <AlertTitle>Check your email</AlertTitle>
            <AlertDescription>
              If an account exists for that email, you&apos;ll receive a link to reset your
              password. It may take a few minutes to arrive.
            </AlertDescription>
          </Alert>
          <Link href="/signin" className="wb-auth-submit">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form action={formAction} className="wb-auth-form">
          {linkExpired ? (
            <Alert className="wb-auth-alert wb-auth-alert-error">
              <AlertDescription>{EXPIRED_RESET_LINK_MESSAGE}</AlertDescription>
            </Alert>
          ) : null}
          <div className="wb-auth-field">
            <label htmlFor="email" className="wb-auth-label">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              className="wb-auth-input"
              autoComplete="email"
              disabled={isLoading}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'forgot-password-error' : undefined}
            />
          </div>
          {error ? (
            <Alert className="wb-auth-alert wb-auth-alert-error">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription id="forgot-password-error">{error}</AlertDescription>
            </Alert>
          ) : null}
          <button type="submit" className="wb-auth-submit" disabled={isLoading}>
            {isLoading ? 'Sending…' : 'Send Reset Link'}
          </button>
          <p className="text-center">
            <Link href="/signin" className="wb-auth-link">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthScreen>
  );
}

function ForgotPasswordFromQuery() {
  const linkExpired = useSearchParams().get('error') === 'expired';
  return <ForgotPasswordRequest linkExpired={linkExpired} />;
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<ForgotPasswordRequest linkExpired={false} />}>
      <ForgotPasswordFromQuery />
    </Suspense>
  );
}
