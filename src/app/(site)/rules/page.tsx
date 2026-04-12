import Link from 'next/link';

const linkClass =
  'font-medium text-primary underline-offset-4 transition-colors hover:underline';

export default function RulesPage() {
  return (
    <main className="min-h-screen bg-background">
      <article className="mx-auto max-w-3xl px-4 py-12 md:px-8 md:py-16">
        <header className="border-b border-border pb-6">
          <h1 className="text-left text-3xl font-bold tracking-tight text-foreground">
            Discount & Challenge Rules
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: 2/22/2026</p>
        </header>

        <div className="mt-8 text-base leading-relaxed text-foreground">
          <p className="mb-4">
            These rules explain how Wanderbite challenges, swaps, and discounts work.
            By using Wanderbite, you agree to follow these rules along with our Terms of Service.
          </p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            Monthly Plan Benefits
          </h2>
          <p className="mb-4">
            Your subscription includes 2 challenges per month and 1 swap per month.
            Challenges and swaps reset monthly and do not roll over unless Wanderbite explicitly states otherwise.
          </p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            How Challenges Work
          </h2>
          <p className="mb-4">
            Each month, Wanderbite assigns you challenges to help you discover participating restaurants.
            Challenge availability may vary based on restaurant participation, capacity, and eligibility
            rules (including cooldowns).
          </p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            Swap Rules
          </h2>
          <p className="mb-4">
            You may use one (1) swap per month to replace one assigned challenge.
            A swap replaces a challenge; it does not add an extra challenge.
            Unused swaps do not roll over.
          </p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            Discount Terms (Default)
          </h2>
          <p className="mb-4">Unless a specific challenge states otherwise, the default discount terms are:</p>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>$10 off your bill with a minimum spend of $40 or more</li>
            <li>The $40 minimum is calculated before tax and tip</li>
            <li>
              Not stackable: cannot be combined with other promotions, coupons, happy hour discounts,
              loyalty rewards, or other offers unless the restaurant explicitly allows it
            </li>
            <li>
              In-person confirmation required at the time of purchase using the method shown in the app
            </li>
          </ul>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            Restaurant Participation and Availability
          </h2>
          <p className="mb-4">
            Restaurants are independent third parties. Participation, hours, menus, and discount
            availability may change at any time.
            Wanderbite does not guarantee that a specific restaurant, cuisine, or location will be
            available in a given month.
          </p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            Cooldowns and Participation Limits
          </h2>
          <p className="mb-4">To help distribute visits fairly and prevent misuse:</p>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>
              <strong>6-month cooldown:</strong> After redeeming a discount at a restaurant, you cannot redeem
              another discount at that same restaurant for 6 months
            </li>
            <li>
              <strong>Rolling 12-month cap:</strong> Maximum of 2 redemptions at the same restaurant within any
              rolling 12-month period
            </li>
          </ul>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            Fair Use / Anti-Abuse
          </h2>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>One account per person</li>
            <li>
              Do not attempt to redeem discounts outside the redemption flow, manipulate check-ins,
              or create duplicate accounts
            </li>
            <li>Wanderbite may limit, suspend, or terminate access for suspected fraud or abuse</li>
          </ul>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            Questions
          </h2>
          <ul className="mb-4 list-none space-y-2 pl-0">
            <li>
              <strong>Contact:</strong>{' '}
              <a href="mailto:support@wanderbite.com" className={linkClass}>
                support@wanderbite.com
              </a>
            </li>
            <li>
              <strong>Company:</strong> Devine Enterprises LLC d/b/a Wanderbite
            </li>
            <li>
              <strong>Mailing Address:</strong> 5900 Balcones Drive #23572, Austin, TX 78731, USA
            </li>
          </ul>

          <p className="mt-10 border-t border-border pt-6 text-sm leading-relaxed text-muted-foreground">
            See also our{' '}
            <Link href="/terms" className={linkClass}>
              Terms of Service
            </Link>
            {' '}and{' '}
            <Link href="/privacy" className={linkClass}>
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </article>
    </main>
  );
}
