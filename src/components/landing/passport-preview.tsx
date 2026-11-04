import { CtaButton } from '@/components/wb/cta-button';
import { Stamp } from '@/components/wb/stamp';
import { LAUNCH_MARKET } from '@/lib/launch-market';
import { cuisineInk } from '@/lib/passport/passport-board';

const EXAMPLES = [
  {
    name: 'Example Kitchen',
    date: 'Mar 12',
    neighborhood: 'Sample',
    tags: ['Pizza'],
    shape: 'rect' as const,
    rotation: -6,
  },
  {
    name: 'Sample Counter',
    date: 'Apr 2',
    neighborhood: 'Example',
    tags: ['Sushi'],
    shape: 'round' as const,
    rotation: 4,
  },
  {
    name: 'Preview Table',
    date: 'May 8',
    neighborhood: 'Preview',
    tags: ['Tacos'],
    shape: 'round' as const,
    rotation: -2,
  },
] as const;

export function PassportPreview() {
  return (
    <section aria-labelledby="passport-preview-heading" className="wb-on-cream">
      <h2
        id="passport-preview-heading"
        className="font-display m-0 text-[36px] leading-none text-wb-ink md:text-[48px]"
      >
        A Passport preview
      </h2>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-wb-muted" data-passport-example="">
        Example only. These stamps are a sample, not a member&apos;s Passport.
      </p>
      <div className="wb-passport-spread mt-8 max-w-3xl">
        <div className="wb-passport-cover">
          <h3 className="font-display m-0 text-[34px] leading-none text-wb-ink">Wanderbite Passport</h3>
          <p className="mt-2 mb-0 text-lg font-semibold text-wb-ink">Example</p>
          <p className="mt-1 mb-0 text-sm text-wb-muted">{LAUNCH_MARKET.displayName}</p>
        </div>
        <div className="wb-passport-spine" aria-hidden="true" />
        <div className="wb-passport-leaf">
          <div className="flex flex-wrap items-center justify-center gap-4">
            {EXAMPLES.map((stamp) => (
              <Stamp
                key={stamp.name}
                name={stamp.name}
                date={stamp.date}
                neighborhood={stamp.neighborhood}
                inkColor={cuisineInk(stamp.tags).color}
                shape={stamp.shape}
                rotation={stamp.rotation}
                href="/signup"
              />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-8">
        <CtaButton href="/signup">Create a free account</CtaButton>
      </div>
    </section>
  );
}
