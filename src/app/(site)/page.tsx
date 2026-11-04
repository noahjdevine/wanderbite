import { HomeHero } from '@/components/landing/home-hero';
import { LandingPage } from '@/components/landing/landing-page';
import { RedirectActiveSubscriber } from '@/components/landing/redirect-active-subscriber';
import { loadHomeHeroCatalog } from '@/lib/home/hero-catalog';
import { loadPublicDirectory } from '@/lib/restaurants/load-directory';

export const revalidate = 3600;

/**
 * Public marketing landing. Revalidated hourly.
 * Active subscribers are redirected to /challenges by RedirectActiveSubscriber.
 * Inactive / unauthenticated visitors stay here.
 */
export default async function Home() {
  const [catalog, directory] = await Promise.all([loadHomeHeroCatalog(), loadPublicDirectory()]);
  if (!directory.ok) {
    console.error('[home] partner directory:', directory.error);
  }

  return (
    <>
      <RedirectActiveSubscriber />
      <HomeHero catalog={catalog} />
      <LandingPage restaurants={directory.ok ? directory.restaurants : []} />
    </>
  );
}
