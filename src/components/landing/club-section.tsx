'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createCheckoutSession } from '@/app/actions/stripe';

type ClubSectionProps = {
  /** When provided, show real Subscribe button; otherwise "Get Started" → /login */
  userId?: string | null;
  email?: string | null;
};

export function ClubSection({ userId, email }: ClubSectionProps) {
  const [loading, setLoading] = useState(false);
  const canSubscribe = userId && email?.trim();

  async function handleSubscribe() {
    if (!canSubscribe) return;
    const safeEmail = email?.trim() ?? '';
    setLoading(true);
    try {
      const result = await createCheckoutSession(userId, safeEmail);
      if (result.ok) {
        window.location.href = result.url;
        return;
      }
      toast.error(result.error);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="py-20" id="club">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col items-center">
          <h2 className="mb-2 text-center text-2xl font-semibold tracking-tight md:text-3xl">
            Join the Club
          </h2>
          <p className="mb-10 max-w-xl text-center text-muted-foreground">
            One simple plan. Two curated spots every month. Real savings.
          </p>
          <Card className="w-full max-w-md border-2 shadow-lg">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Join the Wanderbite Club</CardTitle>
              <CardDescription className="text-base">
                Unlock 2 curated dining adventures every month. Get $10 off at each spot.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-lg font-medium text-foreground">
                Just $15/mo (That&apos;s $20 in value!)
              </p>
            </CardContent>
            <CardFooter className="justify-center">
              {canSubscribe ? (
                <Button onClick={handleSubscribe} disabled={loading} size="lg">
                  {loading ? 'Redirecting…' : 'Subscribe for $15/mo'}
                </Button>
              ) : (
                <Button size="lg" asChild>
                  <Link href="/login">Get Started</Link>
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
      </div>
    </section>
  );
}
