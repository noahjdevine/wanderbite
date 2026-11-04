import { CURATED_ADVENTURES_PER_MONTH } from '@/lib/home/hero';
import { REDEMPTION_CODE_LIFETIME_LABEL } from '@/lib/redemption-expiry';

const STEPS = [
  {
    title: 'Tell us your tastes',
    body: 'Dietary needs, allergies, and cuisines you want to skip come first. A restaurant that conflicts with those is not assigned.',
  },
  {
    title: 'Two adventures a month',
    body: `Members get ${CURATED_ADVENTURES_PER_MONTH} curated restaurant adventures each month.`,
  },
  {
    title: 'Show your code',
    body: `Show your code at the restaurant. Codes expire ${REDEMPTION_CODE_LIFETIME_LABEL} after they are issued. A verified visit adds a stamp to your Passport.`,
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-heading" className="wb-on-cream">
      <h2
        id="how-it-works-heading"
        className="font-display m-0 text-[36px] leading-none text-wb-ink md:text-[48px]"
      >
        How it works
      </h2>
      <ol className="mt-10 grid list-none gap-10 p-0 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-3">
            <span className="font-display text-[28px] leading-none text-wb-pink-ink">{index + 1}</span>
            <h3 className="font-display m-0 text-[28px] leading-none text-wb-ink">{step.title}</h3>
            <p className="m-0 text-base leading-relaxed text-wb-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
