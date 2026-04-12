'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { signUpSchema } from '@/lib/validations/auth';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function safeRedirectPath(redirectTo: string | null): string {
  if (!redirectTo) return '/';
  try {
    const path = decodeURIComponent(redirectTo);
    if (!path.startsWith('/') || path.startsWith('//')) return '/';
    return path;
  } catch {
    return '/';
  }
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPasswordError(null);
    if (!email.trim() || !password) {
      setError('Please enter email and password.');
      return;
    }
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) {
        setError(err.message);
        return;
      }
      router.push(safeRedirectPath(searchParams.get('redirectTo')));
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPasswordError(null);

    const result = signUpSchema.safeParse({
      email: email.trim(),
      password,
      agreeToTerms,
    });

    if (!result.success) {
      const issues = result.error.flatten();
      const passwordMsg = issues.fieldErrors.password?.[0];
      if (passwordMsg) {
        setPasswordError(passwordMsg);
      }
      const otherMsg = issues.fieldErrors.email?.[0] ?? issues.fieldErrors.agreeToTerms?.[0];
      if (otherMsg) {
        setError(otherMsg);
      }
      return;
    }

    setIsLoading(true);
    try {
      const supabase = createClient();
      const { error: err } = await supabase.auth.signUp({
        email: result.data.email,
        password: result.data.password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (err) {
        setError(err.message);
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Welcome</CardTitle>
          <CardDescription>Sign in or create an account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                autoComplete="email"
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-muted-foreground underline hover:text-foreground"
                >
                  Forgot Password?
                </Link>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(null);
                }}
                placeholder="••••••••"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                autoComplete="current-password"
                disabled={isLoading}
                aria-invalid={!!passwordError}
                aria-describedby={passwordError ? 'password-error' : undefined}
              />
              {passwordError && (
                <p id="password-error" className="text-sm text-destructive">
                  {passwordError}
                </p>
              )}
            </div>
            <div className="flex items-start gap-2 space-y-0">
              <input
                id="agree-to-terms"
                type="checkbox"
                checked={agreeToTerms}
                onChange={(e) => setAgreeToTerms(e.target.checked)}
                disabled={isLoading}
                className="mt-1 h-4 w-4 rounded border-input focus:ring-2 focus:ring-ring"
                aria-describedby="agree-to-terms-description"
              />
              <label
                id="agree-to-terms-description"
                htmlFor="agree-to-terms"
                className="text-sm text-muted-foreground"
              >
                I confirm I am at least 21 years of age, and I agree to the{' '}
                <Link
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  Privacy Policy
                </Link>
                .
              </label>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1"
                disabled={isLoading}
                onClick={handleSignIn}
              >
                Sign In
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={isLoading}
                onClick={handleSignUp}
              >
                Sign Up
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              By creating an account, you agree to our{' '}
              <Link href="/terms" className="underline hover:text-foreground">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="underline hover:text-foreground">
                Privacy Policy
              </Link>
              . We use your info to manage your account and subscription. We don&apos;t sell your data.{' '}
              Questions?{' '}
              <a
                href="mailto:privacy@wanderbite.com"
                className="underline hover:text-foreground"
              >
                privacy@wanderbite.com
              </a>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background p-6">
          <Card className="w-full max-w-sm">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Welcome</CardTitle>
              <CardDescription>Loading…</CardDescription>
            </CardHeader>
          </Card>
        </main>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
