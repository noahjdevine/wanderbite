'use client';

import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LaunchHoldNotice } from '@/components/launch-hold-notice';
import { useSupabaseUser } from '@/hooks/use-supabase-user';

export function ClubSection() {
  const { user } = useSupabaseUser();
  const isSignedIn = Boolean(user);

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
                Just $15/mo (That&apos;s $20 in value!) when checkout reopens.
              </p>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <LaunchHoldNotice />
              {!isSignedIn ? (
                <Button size="lg" variant="outline" asChild>
                  <Link href="/signup">Create a free account</Link>
                </Button>
              ) : null}
            </CardFooter>
          </Card>
        </div>
      </div>
    </section>
  );
}
