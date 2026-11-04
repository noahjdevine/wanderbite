import { notFound } from "next/navigation";
import { BookOpen, Compass, Target, Trophy } from "lucide-react";
import { BEA_FOUND_LINES, fillBeaName } from "@/components/bea/copy";
import { BEA_DISPLAY_NAME } from "@/components/bea/name";
import { BeaGallery } from "./bea-gallery";
import { isComponentGalleryEnabled } from "@/lib/dev/component-gallery";
import {
  BadgeMedallion,
  BeaLine,
  ChallengeTicket,
  Chip,
  CtaButton,
  EmptyStampSlot,
  GlassPanel,
  GlassTabBar,
  GlowBorder,
  MemoryCard,
  NextMoveCard,
  OpenStat,
  PendingStamp,
  PillLabel,
  Stamp,
  StatTile,
  StatusTrack,
} from "@/components/wb";
import type { StatusTrackStatus } from "@/components/wb";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Components",
  robots: { index: false, follow: false },
};

const TRACKS: StatusTrackStatus[] = ["ready", "code_issued", "code_expired", "verified", "note_added", "expired", "swapped"];

function BadgeIcon() {
  return (
    <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3.2 14.4 8l5.2.6-3.9 3.5.9 5.1L12 14.8 7.4 17.2l.9-5.1L4.4 8.6 9.6 8 12 3.2Z" />
    </svg>
  );
}

export default function DevComponentsPage() {
  if (!isComponentGalleryEnabled()) notFound();

  return (
    <main className="wb-dark min-h-screen">
      <header className="mx-auto flex max-w-5xl flex-col gap-3 px-5 py-8">
        <PillLabel>Golden Hour specimens</PillLabel>
        <h1 className="wb-display m-0 text-5xl">
          Components, with <em>{BEA_DISPLAY_NAME}</em>
        </h1>
        <p className="m-0 max-w-xl text-sm text-white/75">
          Dev-only gallery. These are design specimens, not a member account.
        </p>
      </header>

      <section aria-label="Bea on night" className="mx-auto flex max-w-5xl flex-col gap-6 px-5 pb-10">
        <h2 className="font-display m-0 text-[30px] font-normal">Bea</h2>
        <p className="m-0 max-w-xl text-sm text-white/75">
          Every state with every food, 32px, 120px, and 320px, on plum and cream. The switcher plays idle to thinking to found to idle, and thinking to found while the bite is in progress.
        </p>
        <BeaGallery />
      </section>

      <section aria-label="Controls on night" className="mx-auto flex max-w-5xl flex-col gap-4 px-5 pb-12">
        <h2 className="font-display m-0 text-[30px] font-normal">Controls on night</h2>
        <div className="flex flex-wrap items-center gap-3">
          <CtaButton href="#bea-cream">Let&apos;s go</CtaButton>
          <CtaButton href="#bea-cream" variant="secondary-dark">
            Another idea
          </CtaButton>
          <CtaButton iconOnly aria-label="Speak your request" variant="secondary-dark">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <path d="M12 17v4" />
            </svg>
          </CtaButton>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip>Date night</Chip>
          <Chip variant="matched">Japanese</Chip>
          <Chip variant="unknown">Quiet? Can&apos;t confirm, ask for a booth</Chip>
        </div>
        <GlassPanel>
          <p className="m-0 text-sm text-white/80">Light glass on night.</p>
        </GlassPanel>
        <GlassPanel variant="dark-card">
          <p className="font-display m-0 text-[40px] leading-none">Umai Sushi</p>
        </GlassPanel>
        <GlowBorder>
          <div className="px-4 py-3 text-sm text-white/80">Glow border, dark base</div>
        </GlowBorder>
        <div className="grid grid-cols-3 gap-2">
          <StatTile value="0" suffix="/2" label="verified" />
          <StatTile value="1" label="code issued" />
          <StatTile value="0" label="swaps left" />
        </div>
      </section>

      <section id="bea-cream" aria-label="Cream sheet" className="wb-sheet wb-on-cream" style={{ marginTop: 0 }}>
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-8">
          <h2 className="wb-display m-0 text-[30px] text-wb-ink">
            Bea on <em>cream</em>
          </h2>
          <div className="flex flex-wrap gap-3">
            <CtaButton href="/challenges">I&apos;m here — get my code</CtaButton>
            <CtaButton href="/challenges" variant="secondary-cream" creamStyle="plum">
              Show code to your server
            </CtaButton>
            <CtaButton href="/challenges" variant="secondary-cream">
              Not now
            </CtaButton>
            <Chip variant="tinted">American</Chip>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <OpenStat value="2" label={<>verified visits<br />+1 pending</>} />
            <OpenStat value="$20" label="saved so far" estimated divided />
            <OpenStat value="1" label={<>neighborhood<br />explored</>} divided />
          </div>

          <BeaLine actions={[{ label: "Yes, remind me", href: "#memory" }, { label: "Not now", href: "#memory" }]}>
            “{fillBeaName(BEA_FOUND_LINES[0], "Noah")} The Common Table would make a lovely slow Sunday.”
          </BeaLine>

          <NextMoveCard
            sentence={<>Visit The Common Table and you&apos;ll level up to <em className="text-wb-pink-ink">The Explorer.</em></>}
            meta="+100 XP · specimen"
            actionHref="/challenges"
            actionLabel="Open challenge"
          />

          <div className="grid max-w-xl gap-3">
            {TRACKS.map((status) => (
              <StatusTrack key={status} status={status} />
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <ChallengeTicket
              name="The Common Table"
              area="McKinney"
              offerAmount="$10 off"
              offerRequirement="when you spend $40+"
              status="ready"
              actionHref="/challenges"
              actionLabel="I'm here — get my code"
              photoLabel="PHOTO · partner interior"
              photoCredit="Photo: Andrew Rodriguez"
              note="Specimen ticket. Not a live challenge."
            />
            <ChallengeTicket
              name="Zen Sushi & Grill"
              area="Stonebridge"
              offerAmount="$10 off"
              offerRequirement="when you spend $40+"
              status="code_issued"
              actionHref="/challenges"
              actionLabel="Show code to your server"
              actionVariant="secondary-cream"
              actionCreamStyle="plum"
              photoLabel="PHOTO · sushi bar"
              badge="Code issued · awaiting verification"
              photoHeight={170}
            />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 rounded-[26px] border border-[#ece2d0] bg-wb-paper px-4 py-6">
            <Stamp name="Cadillac Pizza Pub" date="Feb 2" neighborhood="Downtown" cuisine="pizza" href="#memory" rotation={-8} />
            <Stamp name="The Yard" date="Apr 26" neighborhood="Downtown" cuisine="american" shape="rect" href="#memory" rotation={4} newest />
            <PendingStamp name="Zen Sushi" />
            <EmptyStampSlot href="/challenges" challengeName="The Common Table" />
          </div>

          <div className="flex flex-wrap gap-4">
            <BadgeMedallion name="First Bite" earned earnedLabel="Feb 2" icon={<BadgeIcon />} />
            <BadgeMedallion name="Hat Trick" earned={false} progress={{ current: 2, target: 3 }} icon={<BadgeIcon />} />
          </div>

          <div id="memory" className="max-w-md">
            <MemoryCard
              name="The Yard"
              meta="Apr 26 · Downtown · saved $10"
              note="Amazing outdoor atmosphere and great service!"
              rating={5}
              photoLabel="YOUR PHOTO · patio at dusk"
              editHref="#memory"
              addPhotoHref="#memory"
            />
          </div>

          <div className="relative mx-auto h-28 w-full max-w-[390px]">
            <GlassTabBar
              className="absolute inset-x-0 bottom-0"
              activeHref="/challenges"
              items={[
                { href: "/roulette", label: "Discover", icon: Compass },
                { href: "/challenges", label: "Challenges", icon: Target },
                { href: "/journey", label: "Progress", icon: Trophy },
                { href: "/passport", label: "Passport", icon: BookOpen },
              ]}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
