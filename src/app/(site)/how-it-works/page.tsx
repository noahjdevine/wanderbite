import Link from 'next/link';
import { UtensilsCrossed, Ticket, TrendingUp, Star } from 'lucide-react';
import { PricingFaq } from '@/components/pricing/pricing-faq';

export const revalidate = 86400;

/** Level-up XP thresholds (align with Journey / get-user-stats). */
const LEVEL_UP_TIERS = [
  { xp: 300, title: 'The Explorer' },
  { xp: 1000, title: 'The Tastemaker' },
  { xp: 1500, title: 'The Connoisseur' },
  { xp: 2500, title: 'The Local Legend' },
] as const;

const STEPS = [
  {
    step: 'Step 1',
    title: 'We Pick the Spot',
    body: 'Get two curated restaurant challenges every month—no more endless scrolling.',
    Icon: UtensilsCrossed,
  },
  {
    step: 'Step 2',
    title: 'You Get the Offer',
    body: 'Each challenge shows its discount and minimum spend.',
    Icon: Ticket,
  },
  {
    step: 'Step 3',
    title: 'Rate & Level Up',
    body: 'Complete visits, earn badges, and level up as you explore.',
    Icon: TrendingUp,
  },
] as const;

/**
 * How it Works: public page for both logged-in and logged-out users.
 * Explains the product and includes FAQ (moved from pricing).
 */
const HERO_BG_IMAGE = 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=1920&q=80';
const TIER_BG_IMAGE =
  'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=2000&q=80';

function PhotoScrim({ src }: { src: string }) {
  return (
    <div className="absolute inset-0" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="h-full w-full object-cover" />
      {/* 85% night clears 4.5:1 for white, lavender, and blush on a white photo. */}
      <div className="absolute inset-0 bg-wb-night/85" />
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <main className="overflow-x-clip bg-wb-cream text-wb-ink">
      <section className="wb-dark relative overflow-hidden bg-wb-night text-white">
        <PhotoScrim src={HERO_BG_IMAGE} />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 sm:pb-28">
          <header className="mx-auto max-w-3xl text-center">
            <h1 className="font-display text-[42px] leading-[0.95] text-white sm:text-[56px]">
              How Wanderbite <em className="wb-accent">Works</em>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-[17px] leading-normal text-wb-lavender-2">
              Stop scrolling. Start eating.
            </p>
          </header>
        </div>
      </section>

      <div className="wb-sheet">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="wb-on-cream pt-12 sm:pt-16">
            <section className="mx-auto max-w-3xl" aria-labelledby="curated-heading">
              <div className="wb-card flex flex-col items-center gap-4 px-6 py-8 text-center sm:flex-row sm:gap-6 sm:text-left">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-wb-blush text-wb-plum">
                  <Star className="size-7" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h2
                    id="curated-heading"
                    className="font-display text-[28px] leading-snug text-wb-ink"
                  >
                    We only pick highly-rated, <em className="wb-accent">hand-curated</em> local
                    favorites.
                  </h2>
                  <p className="mt-2 text-base leading-relaxed text-wb-muted">
                    No algorithm dump. Every spot is vetted for quality, variety, and the kind of
                    experience we’d send our friends to.
                  </p>
                </div>
              </div>
            </section>

            <section className="mt-16 sm:mt-20" aria-labelledby="steps-heading">
              <h2
                id="steps-heading"
                className="mb-10 text-center font-display text-[32px] leading-none text-wb-ink md:text-[40px]"
              >
                Three steps to better <em className="wb-accent">nights</em> out
              </h2>
              <ol className="grid list-none gap-6 p-0 md:grid-cols-3">
                {STEPS.map(({ step, title, body, Icon }) => (
                  <li key={title} className="wb-card flex min-w-0 flex-col items-center px-5 py-6 text-center">
                    <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-wb-blush text-wb-plum">
                      <Icon className="size-7" aria-hidden />
                    </div>
                    <span className="mb-2 text-[13px] font-semibold tracking-[0.08em] text-wb-muted">{step}</span>
                    <h3 className="font-display text-[28px] leading-none text-wb-ink">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-wb-muted">{body}</p>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <section
            className="wb-dark relative mt-16 min-h-[480px] overflow-hidden rounded-[26px] text-white sm:mt-20"
            aria-labelledby="level-up-heading"
          >
            <PhotoScrim src={TIER_BG_IMAGE} />
            <div className="relative px-4 py-12 sm:px-6 sm:py-16">
              <h2
                id="level-up-heading"
                className="mb-4 text-center font-display text-[32px] leading-none text-white md:text-[40px]"
              >
                Level Up Your <em className="wb-accent">Palate</em>
              </h2>
              <p className="mx-auto mb-12 max-w-2xl text-center text-base leading-relaxed text-wb-lavender-2">
                Earn XP for every restaurant you visit and every review you leave.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {LEVEL_UP_TIERS.map((tier, index) => (
                  <div
                    key={tier.xp}
                    className="wb-card flex min-w-0 flex-col bg-white px-4 py-5 text-center text-wb-ink"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-wb-blush text-sm font-bold text-wb-blush-ink">
                        {index + 1}
                      </span>
                      <span className="text-sm font-medium leading-none text-wb-muted">{tier.xp} XP</span>
                    </div>
                    <h3 className="mt-3 font-display text-[26px] leading-tight text-wb-plum">{tier.title}</h3>
                    <p className="mt-2 text-sm leading-snug text-wb-muted">{tier.xp} XP milestone</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="wb-on-cream pb-16 sm:pb-20">
            <section className="mt-16 text-center sm:mt-20">
              <Link href="/pricing" className="wb-cta wb-hiw-cta max-w-full text-center text-[15px]">
                See pricing & join the club
              </Link>
            </section>

            <section className="mx-auto mt-16 max-w-2xl sm:mt-20">
              <PricingFaq tone="golden" />
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
