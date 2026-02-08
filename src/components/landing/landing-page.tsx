import { UtensilsCrossed, Ticket, TrendingUp } from 'lucide-react';
import { ClubSection } from '@/components/landing/club-section';
import { HeroSlider } from '@/components/landing/hero-slider';

type LandingPageProps = {
  /** When provided, Club section shows Subscribe; otherwise Get Started → /login */
  userId?: string | null;
  email?: string | null;
};

export function LandingPage({ userId, email }: LandingPageProps) {
  return (
    <main className="min-h-screen bg-background">
      <HeroSlider />

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* How it Works */}
        <section className="py-20" id="how-it-works">
          <h2 className="mb-12 text-center text-2xl font-semibold tracking-tight md:text-3xl">
            How it Works
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

        {/* Club / Pricing */}
        <ClubSection userId={userId} email={email} />
      </div>
    </main>
  );
}
