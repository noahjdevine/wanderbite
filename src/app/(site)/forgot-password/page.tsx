'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { sendPasswordResetEmail } from '@/app/actions/auth';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setIsLoading(true);
    try {
      const result = await sendPasswordResetEmail(email.trim());
      if (result.ok) {
        setSent(true);
        return;
      }
      setError(result.error);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-2xl font-bold tracking-tight">Forgot it? Happens to the best of us.</CardTitle>
          <CardDescription className="text-base">
            Drop your email below and we&apos;ll send a reset link if we find your account.
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
            <form onSubmit={handleSubmit} className="space-y-4">
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
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
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
