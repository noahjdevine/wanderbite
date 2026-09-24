'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Loader2, Check } from 'lucide-react';
import { signUpFromForm } from '@/app/actions/credential-sign-up';
import { signUpSchema } from '@/lib/validations/auth';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PasswordField } from '@/components/auth/password-field';
import { cn } from '@/lib/utils';
import { SIGNUP_EARLY_ACCESS_MESSAGE } from '@/lib/checkout-copy';
import { LEGAL_DOCUMENT_VERSION } from '@/lib/legal-attestation';

const PENDING_EMAIL_KEY = 'wanderbite_pending_signup_email';

export default function SignUpPage() {
  const [state, formAction, isLoading] = useActionState(signUpFromForm, {
    error: null,
    fieldErrors: {},
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmAge21, setConfirmAge21] = useState(false);
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
    confirmAge21?: string;
    agreeToTerms?: string;
  }>({});
  const [touched, setTouched] = useState({
    email: false,
    password: false,
    confirmPassword: false,
    confirmAge21: false,
    agreeToTerms: false,
  });

  const pwdLenOk = password.length >= 8;
  const pwdMatchOk = confirmPassword.length > 0 && password === confirmPassword;

  function runFieldValidation(
    which: 'email' | 'password' | 'confirmPassword' | 'confirmAge21' | 'agreeToTerms',
    next?: Partial<typeof touched>
  ) {
    const t = { ...touched, ...next };
    const partial = {
      email: email.trim(),
      password,
      confirmPassword,
      confirmAge21,
      agreeToTerms,
    };
    const result = signUpSchema.safeParse(partial);

    if (result.success) {
      setFieldErrors((prev) => {
        const n = { ...prev };
        if (which === 'email' || t.email) delete n.email;
        if (which === 'password' || t.password) delete n.password;
        if (which === 'confirmPassword' || t.confirmPassword) delete n.confirmPassword;
        if (which === 'confirmAge21' || t.confirmAge21) delete n.confirmAge21;
        if (which === 'agreeToTerms' || t.agreeToTerms) delete n.agreeToTerms;
        return n;
      });
      return;
    }

    const flat = result.error.flatten().fieldErrors;
    const nextErr: typeof fieldErrors = {};
    if (which === 'email' || t.email) {
      nextErr.email = flat.email?.[0];
    }
    if (which === 'password' || t.password) {
      nextErr.password = flat.password?.[0];
    }
    if (which === 'confirmPassword' || t.confirmPassword) {
      nextErr.confirmPassword = flat.confirmPassword?.[0];
    }
    if (which === 'confirmAge21' || t.confirmAge21) {
      nextErr.confirmAge21 = flat.confirmAge21?.[0];
    }
    if (which === 'agreeToTerms' || t.agreeToTerms) {
      nextErr.agreeToTerms = flat.agreeToTerms?.[0];
    }
    setFieldErrors((prev) => ({ ...prev, ...nextErr }));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const nextEmail = String(formData.get('email') ?? '').trim();
    const nextPassword = String(formData.get('password') ?? '');
    const nextConfirm = String(formData.get('confirmPassword') ?? '');
    const nextAge = formData.get('confirmAge21') === 'true';
    const nextTerms = formData.get('agreeToTerms') === 'true';
    setTouched({
      email: true,
      password: true,
      confirmPassword: true,
      confirmAge21: true,
      agreeToTerms: true,
    });

    const result = signUpSchema.safeParse({
      email: nextEmail,
      password: nextPassword,
      confirmPassword: nextConfirm,
      confirmAge21: nextAge,
      agreeToTerms: nextTerms,
    });
    if (!result.success) {
      event.preventDefault();
      const flat = result.error.flatten().fieldErrors;
      setFieldErrors({
        email: flat.email?.[0],
        password: flat.password?.[0],
        confirmPassword: flat.confirmPassword?.[0],
        confirmAge21: flat.confirmAge21?.[0],
        agreeToTerms: flat.agreeToTerms?.[0],
      });
      return;
    }

    setFieldErrors({});
    try {
      sessionStorage.setItem(PENDING_EMAIL_KEY, nextEmail);
    } catch {
      /* ignore */
    }
  }

  const shown = {
    email: state.fieldErrors.email ?? fieldErrors.email,
    password: state.fieldErrors.password ?? fieldErrors.password,
    confirmPassword: state.fieldErrors.confirmPassword ?? fieldErrors.confirmPassword,
    confirmAge21: state.fieldErrors.confirmAge21 ?? fieldErrors.confirmAge21,
    agreeToTerms: state.fieldErrors.agreeToTerms ?? fieldErrors.agreeToTerms,
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm border-violet-200/60 shadow-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">Start your food adventure.</CardTitle>
          <CardDescription className="text-base">
            Create your account in under a minute.
          </CardDescription>
          <p className="text-sm text-muted-foreground" role="status">
            {SIGNUP_EARLY_ACCESS_MESSAGE}
          </p>
        </CardHeader>
        <CardContent>
          <form action={formAction} onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="signup-email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="signup-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (touched.email) runFieldValidation('email');
                }}
                onBlur={() => {
                  setTouched((x) => ({ ...x, email: true }));
                  runFieldValidation('email', { email: true });
                }}
                placeholder="you@example.com"
                autoComplete="email"
                disabled={isLoading}
                className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-base sm:text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                aria-invalid={!!shown.email}
              />
              {shown.email ? <p className="text-sm text-destructive">{shown.email}</p> : null}
            </div>

            <PasswordField
              id="signup-password"
              name="password"
              label="Password"
              value={password}
              onChange={(v) => {
                setPassword(v);
                if (touched.password) runFieldValidation('password');
              }}
              onBlur={() => {
                setTouched((x) => ({ ...x, password: true }));
                runFieldValidation('password', { password: true });
              }}
              disabled={isLoading}
              autoComplete="new-password"
              error={touched.password || state.fieldErrors.password ? shown.password : null}
            />
            {touched.password && password.length > 0 ? (
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li className="flex items-center gap-2">
                  <Check
                    className={cn('size-3.5', pwdLenOk ? 'text-primary' : 'opacity-30')}
                    aria-hidden
                  />
                  At least 8 characters
                </li>
              </ul>
            ) : null}

            <PasswordField
              id="signup-confirm"
              name="confirmPassword"
              label="Confirm password"
              value={confirmPassword}
              onChange={(v) => {
                setConfirmPassword(v);
                if (touched.confirmPassword) runFieldValidation('confirmPassword');
              }}
              onBlur={() => {
                setTouched((x) => ({ ...x, confirmPassword: true }));
                runFieldValidation('confirmPassword', { confirmPassword: true });
              }}
              disabled={isLoading}
              autoComplete="new-password"
              placeholder="Repeat password"
              error={
                shown.confirmPassword
                  ? shown.confirmPassword
                  : touched.confirmPassword && confirmPassword && !pwdMatchOk
                    ? "Passwords don't match."
                    : null
              }
            />
            {touched.confirmPassword && confirmPassword.length > 0 && pwdMatchOk ? (
              <p className="text-xs font-medium text-primary">Passwords match</p>
            ) : null}

            <p className="text-xs leading-relaxed text-muted-foreground">
              Terms and Privacy version {LEGAL_DOCUMENT_VERSION}.
            </p>

            <div className="flex items-start gap-3">
              <input
                id="signup-age"
                name="confirmAge21"
                type="checkbox"
                value="true"
                checked={confirmAge21}
                onChange={(e) => {
                  setConfirmAge21(e.target.checked);
                  if (touched.confirmAge21) runFieldValidation('confirmAge21');
                }}
                onBlur={() => {
                  setTouched((x) => ({ ...x, confirmAge21: true }));
                  runFieldValidation('confirmAge21', { confirmAge21: true });
                }}
                disabled={isLoading}
                className="mt-1 size-4 shrink-0 rounded border-input"
              />
              <label htmlFor="signup-age" className="text-sm leading-snug text-muted-foreground">
                I confirm I am 21 or older.
              </label>
            </div>
            {(touched.confirmAge21 || state.fieldErrors.confirmAge21) && shown.confirmAge21 ? (
              <p className="text-sm text-destructive">{shown.confirmAge21}</p>
            ) : null}

            <div className="flex items-start gap-3">
              <input
                id="signup-agree"
                name="agreeToTerms"
                type="checkbox"
                value="true"
                checked={agreeToTerms}
                onChange={(e) => {
                  setAgreeToTerms(e.target.checked);
                  if (touched.agreeToTerms) runFieldValidation('agreeToTerms');
                }}
                onBlur={() => {
                  setTouched((x) => ({ ...x, agreeToTerms: true }));
                  runFieldValidation('agreeToTerms', { agreeToTerms: true });
                }}
                disabled={isLoading}
                className="mt-1 size-4 shrink-0 rounded border-input"
              />
              <label htmlFor="signup-agree" className="text-sm leading-snug text-muted-foreground">
                I agree to the{' '}
                <Link href="/terms" className="font-medium text-primary underline-offset-2 hover:underline">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className="font-medium text-primary underline-offset-2 hover:underline">
                  Privacy Policy
                </Link>
                , and{' '}
                <Link href="/rules" className="font-medium text-primary underline-offset-2 hover:underline">
                  Challenge rules
                </Link>
                .
              </label>
            </div>
            {(touched.agreeToTerms || state.fieldErrors.agreeToTerms) && shown.agreeToTerms ? (
              <p className="text-sm text-destructive">{shown.agreeToTerms}</p>
            ) : null}

            {state.error ? (
              <Alert variant="destructive">
                <AlertTitle>Something went wrong</AlertTitle>
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" className="h-11 w-full text-base font-semibold" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Creating your account…
                </>
              ) : (
                'Create my account'
              )}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/signin" className="font-medium text-primary underline-offset-2 hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
