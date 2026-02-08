import Link from 'next/link';
import { UtensilsCrossed, Ticket, TrendingUp, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PricingFaq } from '@/components/pricing/pricing-faq';

export const dynamic = 'force-dynamic';

/** Level-up XP thresholds and perks (align with Journey / get-user-stats). */
const QUARTERLY_BONUS = 'an automatic entry to win 1 of 5 Gift Cards given away this quarter (Value increases per level!)';
const LEVEL_UP_TIERS = [
  { xp: 300, title: 'The Explorer', instantPerk: 'Free App or Drink' },
  { xp: 1000, title: 'The Tastemaker', instantPerk: 'Free Dessert or Specialty Cocktail' },
  { xp: 1500, title: 'The Connoisseur', instantPerk: 'BOGO Entree (Buy 1 Get 1 Free)' },
  { xp: 2500, title: 'The Local Legend', instantPerk: 'Legend Swag Pack' },
] as const;

/**
 * How it Works: public page for both logged-in and logged-out users.
 * Explains the product and includes FAQ (moved from pricing).
 */
const HERO_BG_IMAGE = 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=1920&q=80';

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen bg-background relative">
      {/* Background image: group enjoying restaurant */}
      <div className="fixed inset-0 -z-10" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={HERO_BG_IMAGE}
          alt=""
          className="h-full w-full object-cover opacity-[0.08]"
        />
        <div className="absolute inset-0 bg-background/80" />
      </div>
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 relative">
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

        {/* Level Up Your Palate — background: friends laughing at dinner */}
        <section className="relative mt-20 min-h-[480px] overflow-hidden rounded-2xl">
          <div className="absolute inset-0 z-0" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=2000&q=80"
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-black/60" />
          </div>
          <div className="relative z-10 px-4 py-12 sm:px-6 sm:py-16">
            <h2 className="mb-4 text-center text-2xl font-semibold tracking-tight text-white md:text-3xl">
              Level Up Your Palate
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-center text-white/90">
              Earn XP for every restaurant you visit and every review you leave. Show your status screen to the server to claim your rewards!
            </p>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {LEVEL_UP_TIERS.map((tier, index) => (
                <Card key={tier.xp} className="flex flex-col bg-white/95 shadow-lg backdrop-blur-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                        {index + 1}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {tier.xp} XP
                      </span>
                    </div>
                    <h3 className="font-semibold leading-tight text-foreground">{tier.title}</h3>
                  </CardHeader>
                  <CardContent className="pt-0 text-center">
                    <p className="text-sm font-normal leading-snug text-foreground">
                      {tier.instantPerk}
                    </p>
                    <p className="my-1.5 text-sm font-normal text-foreground">+</p>
                    <p className="text-sm font-normal leading-snug text-foreground">
                      {QUARTERLY_BONUS}
                    </p>
                  </CardContent>
                </Card>
              ))}
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
