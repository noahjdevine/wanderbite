'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { signInFromForm, type SignInFormState } from '@/app/actions/credential-sign-in';
import { signInFieldErrors } from '@/lib/auth/sign-in-destination';
import { safeAuthRedirectPath } from '@/lib/auth/safe-redirect';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AuthScreen } from '@/components/auth/auth-screen';
import { PasswordField } from '@/components/auth/password-field';

const INITIAL_STATE: SignInFormState = {
  error: null,
  emailError: null,
  passwordError: null,
};

const SESSION_ERROR =
  'That confirmation link is invalid or expired. Sign in below, or request a new confirmation email from the signup page.';

type SignInFormProps = {
  redirectTo: string;
  resetSuccess: boolean;
  sessionError: boolean;
};

export function SignInForm({ redirectTo, resetSuccess, sessionError }: SignInFormProps) {
  const [state, formAction, isLoading] = useActionState(signInFromForm, INITIAL_STATE);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);

  useEffect(() => {
    if (!redirectTo) return;
    try {
      sessionStorage.setItem('wb_auth_redirect', safeAuthRedirectPath(redirectTo, '/'));
    } catch {
      /* ignore storage errors */
    }
  }, [redirectTo]);

  function validateEmail(value: string): boolean {
    const errors = signInFieldErrors(value, 'present');
    if (errors?.email) {
      setEmailError(errors.email);
      return false;
    }
    setEmailError(null);
    return true;
  }

  function validatePassword(value: string): boolean {
    const errors = signInFieldErrors('user@example.com', value);
    if (errors?.password) {
      setPasswordError(errors.password);
      return false;
    }
    setPasswordError(null);
    return true;
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const redirectInput = form.elements.namedItem('redirectTo');
    if (redirectInput instanceof HTMLInputElement && !redirectInput.value.trim()) {
      try {
        const stored = sessionStorage.getItem('wb_auth_redirect');
        if (stored) redirectInput.value = stored;
      } catch {
        /* ignore storage errors */
      }
    }
    const formData = new FormData(form);
    const nextEmail = String(formData.get('email') ?? '');
    const nextPassword = String(formData.get('password') ?? '');
    setTouchedEmail(true);
    setTouchedPassword(true);
    const errors = signInFieldErrors(nextEmail, nextPassword);
    if (errors) {
      event.preventDefault();
      setEmailError(errors.email ?? null);
      setPasswordError(errors.password ?? null);
      return;
    }
    try {
      sessionStorage.removeItem('wb_auth_redirect');
    } catch {
      /* ignore */
    }
  }

  const shownEmailError = state.emailError ?? (touchedEmail ? emailError : null);
  const shownPasswordError = state.passwordError ?? (touchedPassword ? passwordError : null);
  const shownError = state.error ?? (sessionError ? SESSION_ERROR : null);

  return (
    <AuthScreen title="Welcome back." lede="Sign in to continue your adventure.">
      <form action={formAction} onSubmit={onSubmit} className="wb-auth-form">
        <input type="hidden" name="redirectTo" defaultValue={redirectTo} />
        <div className="wb-auth-field">
          <label htmlFor="signin-email" className="wb-auth-label">
            Email
          </label>
          <input
            id="signin-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (touchedEmail) validateEmail(e.target.value);
            }}
            onBlur={() => {
              setTouchedEmail(true);
              validateEmail(email);
            }}
            placeholder="you@example.com"
            autoComplete="email"
            disabled={isLoading}
            aria-invalid={!!shownEmailError}
            aria-describedby={shownEmailError ? 'signin-email-error' : undefined}
            className="wb-auth-input"
          />
          {shownEmailError ? (
            <p id="signin-email-error" className="wb-auth-error" aria-live="polite">
              {shownEmailError}
            </p>
          ) : null}
        </div>

        <div className="wb-auth-field">
          <label htmlFor="signin-password" className="wb-auth-label">
            Password
          </label>
          <PasswordField
            id="signin-password"
            name="password"
            tone="night"
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (touchedPassword) validatePassword(v);
            }}
            onBlur={() => {
              setTouchedPassword(true);
              validatePassword(password);
            }}
            disabled={isLoading}
            autoComplete="current-password"
            error={shownPasswordError}
          />
          <Link href="/forgot-password" className="wb-auth-link">
            Forgot it? Happens to the best of us
          </Link>
        </div>

        {resetSuccess ? (
          <Alert className="wb-auth-alert wb-auth-alert-ok">
            <AlertTitle>Password updated</AlertTitle>
            <AlertDescription>
              You&apos;re all set—sign in with your new password.
            </AlertDescription>
          </Alert>
        ) : null}

        {shownError ? (
          <Alert className="wb-auth-alert wb-auth-alert-error">
            <AlertTitle>Can&apos;t sign you in</AlertTitle>
            <AlertDescription>{shownError}</AlertDescription>
          </Alert>
        ) : null}

        <button type="submit" className="wb-auth-submit" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="size-4 animate-spin wb-auth-spinner" aria-hidden />
              Signing you in…
            </>
          ) : (
            'Sign me in'
          )}
        </button>

        <p className="wb-auth-muted text-center">
          New to Wanderbite?{' '}
          <Link href="/signup" className="wb-auth-link">
            Create an account
          </Link>
        </p>
      </form>
    </AuthScreen>
  );
}
