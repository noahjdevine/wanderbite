import Image from 'next/image';
import { GlassPanel } from '@/components/wb/glass-panel';
import { PillLabel } from '@/components/wb/pill-label';
import { RestaurantPhoto } from '@/components/restaurants/restaurant-photo';
import { HomeHeroPrompt } from '@/components/landing/home-hero-prompt';
import { partnerSpotLabel } from '@/lib/home/hero';
import type { HomeHeroCatalog } from '@/lib/home/hero-catalog';

/**
 * TODO: replace with a licensed friends-at-dinner photo, or a real partner interior.
 * The local placeholder keeps a fixed frame and avoids a remote image on first paint.
 */
const HERO_PHOTO = '/images/restaurant-placeholder.jpg';

function Spark({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z" />
    </svg>
  );
}

function Doodle() {
  return (
    <svg
      className="wb-draw mb-2 text-white/85"
      aria-hidden="true"
      width="180"
      height="140"
      viewBox="0 0 200 160"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M30 82 H170 A70 58 0 0 1 30 82 Z" />
      <path d="M72 146 H128" />
      <path d="M118 18 L176 76" />
      <path d="M134 12 L188 70" />
      <path d="M80 62 C72 52 88 44 80 32" />
      <path d="M100 62 C92 52 108 44 100 32" />
      <path d="M42 82 C62 94 82 74 102 86 S142 78 160 88" />
    </svg>
  );
}

function PickCard({ catalog }: { catalog: HomeHeroCatalog }) {
  const pick = catalog.pick;
  const detail =
    pick.kind === 'partner'
      ? [pick.cuisine, pick.offerLabel].filter((part): part is string => Boolean(part)).join(' · ')
      : null;

  return (
    <div className="wb-float w-full max-w-[290px]">
      <GlassPanel radius={26} padding={12} className="w-full">
        <div className="relative h-[170px] overflow-hidden rounded-[18px] bg-wb-night-2">
          {pick.kind === 'partner' ? (
            <RestaurantPhoto
              restaurantId={pick.id}
              imageUrl={pick.imageUrl}
              googlePlaceId={pick.googlePlaceId}
              className="h-full w-full object-cover"
            />
          ) : (
            // Card thumbnails stay on img. The hero frame above is the next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={HERO_PHOTO} alt="" className="h-full w-full object-cover" />
          )}
          <span className="absolute top-2.5 left-2.5 rounded-full bg-wb-blush px-2.5 py-1 text-xs font-semibold text-wb-blush-ink">
            {pick.kind === 'partner' ? 'Partner spot' : 'Sample'}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 px-1.5 pt-3.5 pb-1.5">
          <span className="font-display text-[30px] leading-none text-white">
            {pick.kind === 'partner' ? pick.name : 'A partner spot'}
          </span>
          {pick.kind === 'partner' && detail ? (
            <span className="text-[13px] text-white/80">{detail}</span>
          ) : null}
          {pick.kind === 'sample' ? (
            <span className="text-[13px] text-white/80">A real partner shows up here.</span>
          ) : null}
        </div>
      </GlassPanel>
    </div>
  );
}

function Facts({ catalog }: { catalog: HomeHeroCatalog }) {
  const rows = [
    catalog.partnerCount == null
      ? null
      : { value: catalog.partnerCount, label: partnerSpotLabel(catalog.partnerCount) },
    catalog.adventures,
  ].filter((row): row is { value: number; label: string } => row != null);
  if (rows.length === 0) return null;

  return (
    <GlassPanel radius={22} padding={18} className="mt-4 w-full max-w-[220px]">
      <div className="flex flex-col gap-3.5">
        {rows.map((row, index) => (
          <div key={row.label} className="flex flex-col gap-0.5">
            {index > 0 ? <div className="mb-3.5 h-px bg-white/15" aria-hidden="true" /> : null}
            <span className="font-display text-[40px] leading-none text-white">{row.value}</span>
            <span className="text-[13px] text-white/80">{row.label}</span>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}

function Marquee({ names }: { names: string[] }) {
  const run = (hidden: boolean) => (
    <div aria-hidden={hidden || undefined} className="flex items-center gap-12 pr-12">
      {names.map((name) => (
        <span key={`${hidden ? 'b' : 'a'}-${name}`} className="font-display text-[26px] whitespace-nowrap text-white/55">
          {name}
        </span>
      ))}
      <span aria-hidden="true" className="text-white/40">
        ✦
      </span>
    </div>
  );

  return (
    <div className="overflow-hidden pt-8 pb-8" aria-label="Partner restaurants">
      <div className="wb-marquee flex w-max">
        {run(false)}
        {run(true)}
      </div>
    </div>
  );
}

export function HomeHero({ catalog }: { catalog: HomeHeroCatalog }) {
  return (
    <section
      aria-label="Dinner, curated for you"
      className="wb-dark relative flex min-h-[calc(100svh-3.5rem)] flex-col overflow-hidden bg-wb-night text-white xl:min-h-[900px]"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="wb-drift absolute inset-[-4%]">
          <Image
            src={HERO_PHOTO}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        </div>
        <div className="wb-bokeh absolute top-[22%] left-[62%] h-[90px] w-[90px] rounded-full bg-[rgba(253,186,116,0.55)] blur-[14px]" />
        <div className="wb-bokeh absolute top-[30%] left-[80%] h-[50px] w-[50px] rounded-full bg-[rgba(251,207,232,0.6)] blur-[10px]" />
        <div className="wb-bokeh absolute top-[64%] left-[72%] h-[120px] w-[120px] rounded-full bg-[rgba(251,113,133,0.4)] blur-[22px]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(18,10,36,0.92)_0%,rgba(18,10,36,0.74)_38%,rgba(18,10,36,0.18)_70%,rgba(18,10,36,0.28)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-[220px] bg-gradient-to-t from-wb-night to-transparent" />
      </div>

      <p className="pointer-events-none absolute bottom-20 left-4 z-[1] text-[11px] text-white/85 sm:left-10">
        Placeholder photo
      </p>

      <div className="relative z-10 mx-auto flex w-full max-w-[1280px] flex-1 flex-col px-4 pt-5 min-[960px]:px-10 xl:pt-28">
        <div className="grid items-start gap-8 min-[960px]:grid-cols-[minmax(0,640px)_minmax(260px,1fr)]">
          <div className="flex max-w-[640px] flex-col gap-5 min-[960px]:gap-6">
            <PillLabel>
              <Spark />
              {catalog.curatingLabel}
            </PillLabel>
            <h1 className="font-display text-[52px] leading-[0.92] tracking-[-1px] text-white min-[960px]:text-[84px] xl:text-[104px] xl:tracking-[-2px]">
              Dinner,
              <br />
              <em className="wb-accent">curated</em> for you.
            </h1>
            <p className="max-w-[500px] text-[17px] leading-normal text-white/85 min-[960px]:text-[19px]">
              Tell Bea what you&apos;re craving. She knows every partner spot in town, and she remembers what you love.
            </p>
            <HomeHeroPrompt />
          </div>

          <div className="relative hidden min-w-0 min-[960px]:block">
            <div className="relative max-w-[320px]">
              <Doodle />
              <PickCard catalog={catalog} />
              <div
                aria-hidden="true"
                className="wb-float absolute top-[250px] right-0 h-[118px] w-[118px] rounded-full border-[3px] border-wb-blush p-1.5"
              >
                <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-full border border-dashed border-wb-blush text-center text-wb-blush">
                  <span className="text-[8px] font-bold tracking-[1.6px]">WANDERBITE</span>
                  <span className="font-display text-2xl leading-none italic">Stamped</span>
                  <span className="text-[9px] font-bold tracking-[1.6px]">{catalog.sealCity}</span>
                </div>
              </div>
              <div className="pt-16">
                <Facts catalog={catalog} />
              </div>
            </div>
          </div>
        </div>

        {catalog.marqueeNames ? (
          <div className="mt-auto">
            <Marquee names={catalog.marqueeNames} />
          </div>
        ) : (
          <div className="mt-auto h-8" />
        )}
      </div>
    </section>
  );
}
