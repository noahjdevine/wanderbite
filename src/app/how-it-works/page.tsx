import Link from 'next/link';
import { UtensilsCrossed, Ticket, TrendingUp, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PricingFaq } from '@/components/pricing/pricing-faq';

export const dynamic = 'force-dynamic';

/**
 * How it Works: public page for both logged-in and logged-out users.
 * Explains the product and includes FAQ (moved from pricing).
 */
export default function HowItWorksPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            How Wanderbite Works
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Stop scrolling. Start eating.
          </p>
        </header>

        {/* Curated quality */}
        <section className="mx-auto mt-16 max-w-3xl">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-primary/20 bg-primary/5 px-6 py-8 text-center sm:flex-row sm:gap-6 sm:text-left">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Star className="size-7" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                We only pick highly-rated, hand-curated local favorites.
              </h2>
              <p className="mt-2 text-muted-foreground">
                No algorithm dump. Every spot is vetted for quality, variety, and the kind of experience we’d send our friends to.
              </p>
            </div>
          </div>
        </section>

        {/* Steps */}
        <section className="mt-20">
          <h2 className="mb-12 text-center text-2xl font-semibold tracking-tight md:text-3xl">
            Three steps to better nights out
          </h2>
          <div className="grid gap-10 md:grid-cols-3">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UtensilsCrossed className="size-7" />
              </div>
              <span className="mb-2 text-sm font-medium text-muted-foreground">Step 1</span>
              <h3 className="font-semibold">We Pick the Spot</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Get two curated restaurant challenges every month—no more endless scrolling.
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Ticket className="size-7" />
              </div>
              <span className="mb-2 text-sm font-medium text-muted-foreground">Step 2</span>
              <h3 className="font-semibold">You Get $10 Off</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Use your offer at each spot. Save $20 a month on great food.
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <TrendingUp className="size-7" />
              </div>
              <span className="mb-2 text-sm font-medium text-muted-foreground">Step 3</span>
              <h3 className="font-semibold">Rate & Level Up</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Complete visits, earn badges, and unlock more perks as you level up.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mt-20 text-center">
          <Button size="lg" asChild>
            <Link href="/pricing">See pricing & join the club</Link>
          </Button>
        </section>

        {/* FAQ */}
        <section className="mx-auto mt-24 max-w-2xl">
          <PricingFaq />
        </section>
      </div>
    </main>
  );
}
