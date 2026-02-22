import Link from 'next/link';

export default function RulesPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto py-12 px-4 md:px-8 prose prose-violet">
        <h1 className="text-3xl font-bold tracking-tight">Discount & Challenge Rules</h1>
        <p className="text-muted-foreground font-medium">Wanderbite</p>
        <p className="text-muted-foreground">Last updated: 2/22/2026</p>

        <p>
          These rules explain how Wanderbite challenges, swaps, and discounts work.
          By using Wanderbite, you agree to follow these rules along with our Terms of Service.
        </p>

        <h2>Monthly Plan Benefits</h2>
        <p>
          Your subscription includes 2 challenges per month and 1 swap per month.
          Challenges and swaps reset monthly and do not roll over unless Wanderbite explicitly states otherwise.
        </p>

        <h2>How Challenges Work</h2>
        <p>
          Each month, Wanderbite assigns you challenges to help you discover participating restaurants.
          Challenge availability may vary based on restaurant participation, capacity, and eligibility
          rules (including cooldowns).
        </p>

        <h2>Swap Rules</h2>
        <p>
          You may use one (1) swap per month to replace one assigned challenge.
          A swap replaces a challenge; it does not add an extra challenge.
          Unused swaps do not roll over.
        </p>

        <h2>Discount Terms (Default)</h2>
        <p>Unless a specific challenge states otherwise, the default discount terms are:</p>
        <ul>
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

        <h2>Restaurant Participation and Availability</h2>
        <p>
          Restaurants are independent third parties. Participation, hours, menus, and discount
          availability may change at any time.
          Wanderbite does not guarantee that a specific restaurant, cuisine, or location will be
          available in a given month.
        </p>

        <h2>Cooldowns and Participation Limits</h2>
        <p>To help distribute visits fairly and prevent misuse:</p>
        <ul>
          <li>
            <strong>6-month cooldown:</strong> After redeeming a discount at a restaurant, you cannot redeem
            another discount at that same restaurant for 6 months
          </li>
          <li>
            <strong>Rolling 12-month cap:</strong> Maximum of 2 redemptions at the same restaurant within any
            rolling 12-month period
          </li>
        </ul>

        <h2>Fair Use / Anti-Abuse</h2>
        <ul>
          <li>One account per person</li>
          <li>
            Do not attempt to redeem discounts outside the redemption flow, manipulate check-ins,
            or create duplicate accounts
          </li>
          <li>Wanderbite may limit, suspend, or terminate access for suspected fraud or abuse</li>
        </ul>

        <h2>Questions</h2>
        <p>
          <strong>Contact:</strong>{' '}
          <a
            href="mailto:support@wanderbite.com"
            className="text-primary underline hover:no-underline"
          >
            support@wanderbite.com
          </a>
        </p>
        <p><strong>Company:</strong> Devine Enterprises LLC d/b/a Wanderbite</p>
        <p><strong>Mailing Address:</strong> 5900 Balcones Drive #23572, Austin, TX 78731, USA</p>

        <p className="mt-8 text-sm text-muted-foreground">
          See also our{' '}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>
          {' '}and{' '}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
