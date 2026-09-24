'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { sendPasswordResetFromForm } from '@/app/actions/credential-password';

export default function ForgotPasswordPage() {
  const [state, formAction, isLoading] = useActionState(sendPasswordResetFromForm, null);
  const sent = state?.ok === true;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-2xl font-bold tracking-tight">Forgot it? Happens to the best of us.</CardTitle>
          <CardDescription className="text-base">
            Drop your email below and we&apos;ll send a reset link if an account exists for it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sent ? (
            <>
              <Alert className="border-green-200 bg-green-50 text-green-800">
                <AlertTitle>Check your email</AlertTitle>
                <AlertDescription>
                  If an account exists for that email, you&apos;ll receive a link to reset your
                  password. It may take a few minutes to arrive.
                </AlertDescription>
              </Alert>
              <Button asChild className="w-full" variant="outline">
                <Link href="/signin">Back to sign in</Link>
              </Button>
            </>
          ) : (
            <form action={formAction} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                  autoComplete="email"
                  disabled={isLoading}
                />
              </div>
              {state && !state.ok ? (
                <Alert variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{state.error}</AlertDescription>
                </Alert>
              ) : null}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Sending…' : 'Send Reset Link'}
              </Button>
              <Button asChild variant="ghost" className="w-full">
                <Link href="/signin">Back to sign in</Link>
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
