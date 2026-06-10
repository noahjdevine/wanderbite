import { LandingPage } from '@/components/landing/landing-page';
import { RedirectActiveSubscriber } from '@/components/landing/redirect-active-subscriber';
import { RouletteHero } from '@/components/roulette/roulette-hero';

export const revalidate = 3600;

/**
 * Public marketing landing. Statically rendered (revalidated hourly).
 * Active subscribers are redirected to /challenges by the client component
 * RedirectActiveSubscriber. Inactive / unauthenticated visitors stay here.
 */
export default function Home() {
  return (
    <>
      <RedirectActiveSubscriber />
      <RouletteHero />
      <LandingPage />
    </>
  );
}
