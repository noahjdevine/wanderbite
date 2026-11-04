import { HomeHero } from '@/components/landing/home-hero';
import { LandingPage } from '@/components/landing/landing-page';
import { RedirectActiveSubscriber } from '@/components/landing/redirect-active-subscriber';
import { loadHomeHeroCatalog } from '@/lib/home/hero-catalog';

export const revalidate = 3600;

/**
 * Public marketing landing. Revalidated hourly.
 * Active subscribers are redirected to /challenges by RedirectActiveSubscriber.
 * Inactive / unauthenticated visitors stay here.
 */
export default async function Home() {
  const catalog = await loadHomeHeroCatalog();
  return (
    <>
      <RedirectActiveSubscriber />
      <HomeHero catalog={catalog} />
      <LandingPage />
    </>
  );
}
