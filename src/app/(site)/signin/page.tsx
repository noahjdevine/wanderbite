'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { safeAuthRedirectPath } from '@/lib/auth/safe-redirect';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PasswordField } from '@/components/auth/password-field';

function SignInInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  useEffect(() => {
    if (searchParams.get('reset') === 'success') {
      setResetSuccess(true);
    }
  }, [searchParams]);

  function validateEmail(): boolean {
    const t = email.trim();
    if (!t) {
      setEmailError('Enter your email.');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
      setEmailError("That doesn't look like a valid email.");
      return false;
    }
    setEmailError(null);
    return true;
  }

  function validatePassword(): boolean {
    if (!password) {
      setPasswordError('Enter your password.');
      return false;
    }
    setPasswordError(null);
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setTouchedEmail(true);
    setTouchedPassword(true);
    const okE = validateEmail();
    const okP = validatePassword();
    if (!okE || !okP) return;

    setIsLoading(true);
    try {
      const supabase = createClient();
      const { data, error: err } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (err) {
        setError(err.message);
        return;
      }
      if (!data.user) {
        setError('Something went wrong. Please try again.');
        return;
      }

      const explicit = searchParams.get('redirectTo');
      if (explicit) {
        router.push(safeAuthRedirectPath(explicit, '/dashboard'));
        router.refresh();
        return;
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('id, subscription_status')
        .eq('id', data.user.id)
        .maybeSingle();

      if (!profile) {
        router.push('/onboarding');
      } else {
        const sub =
          (profile as { subscription_status: string | null }).subscription_status ?? null;
        router.push(sub === 'active' ? '/challenges' : '/pricing');
      }
      router.refresh();
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
          <CardTitle className="text-2xl font-bold tracking-tight">Welcome back.</CardTitle>
          <CardDescription className="text-base">
            Sign in to continue your adventure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="signin-email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="signin-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (touchedEmail) validateEmail();
                }}
                onBlur={() => {
                  setTouchedEmail(true);
                  validateEmail();
                }}
                placeholder="you@example.com"
                autoComplete="email"
                disabled={isLoading}
                aria-invalid={!!emailError}
                aria-describedby={emailError ? 'signin-email-error' : undefined}
                className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-base sm:text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
              {emailError ? (
                <p id="signin-email-error" className="text-sm text-destructive">
                  {emailError}
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
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  if (touchedPassword) validatePassword();
                }}
                onBlur={() => {
                  setTouchedPassword(true);
                  validatePassword();
                }}
                disabled={isLoading}
                autoComplete="current-password"
                error={touchedPassword ? passwordError : null}
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

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Can&apos;t sign you in</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
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

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background p-6">
          <Card className="w-full max-w-sm">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Welcome back</CardTitle>
              <CardDescription>Loading…</CardDescription>
            </CardHeader>
          </Card>
        </main>
      }
    >
      <SignInInner />
    </Suspense>
  );
}
