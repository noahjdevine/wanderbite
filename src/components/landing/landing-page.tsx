import { HowItWorks } from '@/components/landing/how-it-works';
import { MembershipSection } from '@/components/landing/membership-section';
import { PartnerPhotoGrid } from '@/components/landing/partner-photo-grid';
import { PassportPreview } from '@/components/landing/passport-preview';
import { Reveal } from '@/components/wb/reveal';
import { selectPartnerPhotos } from '@/lib/home/partner-grid';
import type { DirectoryRestaurant } from '@/lib/restaurants/directory';

type LandingPageProps = {
  restaurants: readonly DirectoryRestaurant[];
};

export function LandingPage({ restaurants }: LandingPageProps) {
  const partners = selectPartnerPhotos(restaurants);

  return (
    <main id="landing-continue" className="wb-sheet wb-on-cream">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 py-16 sm:px-6 md:gap-24 md:py-24 lg:px-8">
        <Reveal>
          <HowItWorks />
        </Reveal>
        {partners.length > 0 ? (
          <Reveal>
            <PartnerPhotoGrid restaurants={partners} />
          </Reveal>
        ) : null}
        <Reveal>
          <PassportPreview />
        </Reveal>
        <Reveal>
          <MembershipSection />
        </Reveal>
      </div>
    </main>
  );
}
