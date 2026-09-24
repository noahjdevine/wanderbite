'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { signInFromForm, type SignInFormState } from '@/app/actions/credential-sign-in';
import { signInFieldErrors } from '@/lib/auth/sign-in-destination';
import { safeAuthRedirectPath } from '@/lib/auth/safe-redirect';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm border-violet-200/60 shadow-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">Welcome back.</CardTitle>
          <CardDescription className="text-base">
            Sign in to continue your adventure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} onSubmit={onSubmit} className="space-y-4">
            <input type="hidden" name="redirectTo" defaultValue={redirectTo} />
            <div className="space-y-2">
              <label htmlFor="signin-email" className="text-sm font-medium">
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
                className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-base sm:text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
              {shownEmailError ? (
                <p id="signin-email-error" className="text-sm text-destructive">
                  {shownEmailError}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Password</span>
                <Link
                  href="/forgot-password"
                  className="text-sm text-primary underline-offset-2 hover:underline"
                >
                  Forgot it? Happens to the best of us
                </Link>
              </div>
              <PasswordField
                id="signin-password"
                name="password"
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
            </div>

            {resetSuccess ? (
              <Alert className="border-primary/30 bg-primary/5">
                <AlertTitle>Password updated</AlertTitle>
                <AlertDescription>
                  You&apos;re all set—sign in with your new password.
                </AlertDescription>
              </Alert>
            ) : null}

            {shownError ? (
              <Alert variant="destructive">
                <AlertTitle>Can&apos;t sign you in</AlertTitle>
                <AlertDescription>{shownError}</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" className="h-11 w-full text-base font-semibold" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Signing you in…
                </>
              ) : (
                'Sign me in'
              )}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              New to Wanderbite?{' '}
              <Link href="/signup" className="font-medium text-primary underline-offset-2 hover:underline">
                Create an account
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
