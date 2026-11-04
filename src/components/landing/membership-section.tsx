import { MembershipCta } from '@/components/landing/membership-cta';
import { LaunchHoldNotice } from '@/components/launch-hold-notice';
import { CURATED_ADVENTURES_PER_MONTH } from '@/lib/home/hero';
import { LAUNCH_MARKET } from '@/lib/launch-market';

export function MembershipSection() {
  return (
    <section id="membership" aria-labelledby="membership-heading" className="wb-on-cream">
      <h2
        id="membership-heading"
        className="font-display m-0 text-[36px] leading-none text-wb-ink md:text-[48px]"
      >
        Membership
      </h2>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-wb-muted">
        Wanderbite is curating in {LAUNCH_MARKET.displayName}. Members get{' '}
        {CURATED_ADVENTURES_PER_MONTH} restaurant adventures a month. Paid checkout is not open on
        this page.
      </p>
      <div className="mt-8 flex max-w-md flex-col gap-4 rounded-[26px] bg-white p-6 shadow-[var(--wb-shadow-card)]">
        <LaunchHoldNotice className="border-wb-line bg-wb-paper" />
        <p className="m-0 text-sm leading-relaxed text-wb-muted">
          Creating a free account does not start a paid plan.
        </p>
        <MembershipCta />
      </div>
    </section>
  );
}
