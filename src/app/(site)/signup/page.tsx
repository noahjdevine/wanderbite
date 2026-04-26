'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { signUpSchema } from '@/lib/validations/auth';
import { getEmailConfirmCallbackUrl } from '@/lib/auth/safe-redirect';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PasswordField } from '@/components/auth/password-field';
import { cn } from '@/lib/utils';

const PENDING_EMAIL_KEY = 'wanderbite_pending_signup_email';

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
    agreeToTerms?: string;
  }>({});
  const [touched, setTouched] = useState({
    email: false,
    password: false,
    confirmPassword: false,
    agreeToTerms: false,
  });

  const pwdLenOk = password.length >= 8;
  const pwdMatchOk =
    confirmPassword.length > 0 && password === confirmPassword;

  function runFieldValidation(
    which: 'email' | 'password' | 'confirmPassword' | 'agreeToTerms',
    next?: Partial<typeof touched>
  ) {
    const t = { ...touched, ...next };
    const partial = {
      email: email.trim(),
      password,
      confirmPassword,
      agreeToTerms,
    };
    const result = signUpSchema.safeParse(partial);

    if (result.success) {
      setFieldErrors((prev) => {
        const n = { ...prev };
        if (which === 'email' || t.email) delete n.email;
        if (which === 'password' || t.password) delete n.password;
        if (which === 'confirmPassword' || t.confirmPassword) delete n.confirmPassword;
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
    if (which === 'agreeToTerms' || t.agreeToTerms) {
      nextErr.agreeToTerms = flat.agreeToTerms?.[0];
    }
    setFieldErrors((prev) => ({ ...prev, ...nextErr }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setTouched({
      email: true,
      password: true,
      confirmPassword: true,
      agreeToTerms: true,
    });

    const result = signUpSchema.safeParse({
      email: email.trim(),
      password,
      confirmPassword,
      agreeToTerms,
    });

    if (!result.success) {
      const flat = result.error.flatten().fieldErrors;
      setFieldErrors({
        email: flat.email?.[0],
        password: flat.password?.[0],
        confirmPassword: flat.confirmPassword?.[0],
        agreeToTerms: flat.agreeToTerms?.[0],
      });
      return;
    }

    setIsLoading(true);
    try {
      const supabase = createClient();
      const redirectUrl = getEmailConfirmCallbackUrl(window.location.origin);
      const { data, error: err } = await supabase.auth.signUp({
        email: result.data.email,
        password: result.data.password,
        options: { emailRedirectTo: redirectUrl },
      });
      if (err) {
        setError(err.message);
        return;
      }
      const addr = data.user?.email ?? result.data.email;
      try {
        sessionStorage.setItem(PENDING_EMAIL_KEY, addr);
      } catch {
        /* ignore */
      }
      router.push('/signup/check-email');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm border-violet-200/60 shadow-md">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">Start your food adventure.</CardTitle>
          <CardDescription className="text-base">
            Create your account in under a minute.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="signup-email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="signup-email"
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
                aria-invalid={!!fieldErrors.email}
              />
              {fieldErrors.email ? (
                <p className="text-sm text-destructive">{fieldErrors.email}</p>
              ) : null}
            </div>

            <PasswordField
              id="signup-password"
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
              error={touched.password ? fieldErrors.password : null}
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
                touched.confirmPassword && fieldErrors.confirmPassword
                  ? fieldErrors.confirmPassword
                  : touched.confirmPassword && confirmPassword && !pwdMatchOk
                    ? "Passwords don't match."
                    : null
              }
            />
            {touched.confirmPassword && confirmPassword.length > 0 && pwdMatchOk ? (
              <p className="text-xs font-medium text-primary">Passwords match</p>
            ) : null}

            <div className="flex items-start gap-3">
              <input
                id="signup-agree"
                type="checkbox"
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
                .
              </label>
            </div>
            {touched.agreeToTerms && fieldErrors.agreeToTerms ? (
              <p className="text-sm text-destructive">{fieldErrors.agreeToTerms}</p>
            ) : null}

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Something went wrong</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
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

            <p className="text-xs leading-relaxed text-muted-foreground">
              Cocktail bar experiences are optional. If you opt in later, we&apos;ll ask you to confirm you&apos;re
              21+ on the preferences screen—that keeps signup simple for everyone else.
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
