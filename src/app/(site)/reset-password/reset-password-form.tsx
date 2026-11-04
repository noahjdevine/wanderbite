'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { updatePasswordFromForm } from '@/app/actions/credential-password';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AuthScreen } from '@/components/auth/auth-screen';

export function ResetPasswordForm() {
  const [state, formAction, isLoading] = useActionState(updatePasswordFromForm, {
    error: null,
  });

  return (
    <AuthScreen title="Set new password" lede="Enter your new password below.">
      <form action={formAction} className="wb-auth-form">
        <div className="wb-auth-field">
          <label htmlFor="password" className="wb-auth-label">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            minLength={6}
            className="wb-auth-input"
            autoComplete="new-password"
            disabled={isLoading}
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? 'reset-password-error' : undefined}
          />
        </div>
        <div className="wb-auth-field">
          <label htmlFor="confirm-password" className="wb-auth-label">
            Confirm password
          </label>
          <input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            placeholder="••••••••"
            minLength={6}
            className="wb-auth-input"
            autoComplete="new-password"
            disabled={isLoading}
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? 'reset-password-error' : undefined}
          />
        </div>
        {state.error ? (
          <Alert className="wb-auth-alert wb-auth-alert-error">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription id="reset-password-error">{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <button type="submit" className="wb-auth-submit" disabled={isLoading}>
          {isLoading ? 'Updating…' : 'Update password'}
        </button>
        <p className="text-center">
          <Link href="/signin" className="wb-auth-link">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthScreen>
  );
}
