import Link from 'next/link';

const linkClass =
  'font-medium text-primary underline-offset-4 transition-colors hover:underline';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <article className="mx-auto max-w-3xl px-4 py-12 md:px-8 md:py-16">
        <header className="border-b border-border pb-6">
          <h1 className="text-left text-3xl font-bold tracking-tight text-foreground">
            Privacy Policy (Wanderbite)
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: 2/22/2026</p>
        </header>

        <div className="mt-8 text-base leading-relaxed text-foreground">
          <p className="mb-4">
            Wanderbite (&quot;Wanderbite,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is operated by Devine Enterprises LLC d/b/a Wanderbite (&quot;Company&quot;). We respect your privacy. This Privacy Policy explains what information we collect, how we use it, how we share it, and the choices you have.
          </p>
          <p className="mb-4">By using Wanderbite, you agree to this Privacy Policy.</p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            1) Information We Collect
          </h2>

          <h3 className="mb-2 mt-6 text-lg font-semibold text-foreground">
            A) Information you provide directly
          </h3>
          <p className="mb-4">We collect information you choose to provide, including:</p>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>
              <strong>Name</strong> — Your display name and/or full name when you create an account or update your profile.
            </li>
            <li>
              <strong>Email</strong> — Your email address for account creation, login, and transactional communications (e.g., subscription and redemption confirmations).
            </li>
            <li>
              <strong>Preferences</strong> — Information you choose to share such as dietary preferences or allergy-related preferences (if you provide them).
            </li>
            <li>
              <strong>Support communications</strong> — Information you include when contacting support (messages, screenshots, or other details).
            </li>
          </ul>

          <h3 className="mb-2 mt-6 text-lg font-semibold text-foreground">
            B) Location and check-ins
          </h3>
          <p className="mb-4">We may collect location-related information in the following ways:</p>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>
              <strong>Check-ins / redemptions</strong> — When you choose to check in or redeem a challenge at a restaurant, we record the restaurant and the time of the activity.
            </li>
            <li>
              <strong>Approximate location (optional)</strong> — If you allow it, we may use approximate location information (such as city/area or device-derived approximation) to show restaurants and experiences that are relevant to where you are.
            </li>
          </ul>
          <p className="mb-4">
            We do not require you to share precise GPS location to use the Service unless the app explicitly asks and you grant permission. You can manage location permissions in your device settings.
          </p>

          <h3 className="mb-2 mt-6 text-lg font-semibold text-foreground">
            C) Subscription and transaction information
          </h3>
          <p className="mb-4">
            If you subscribe, payments are handled by third-party payment processors. We receive and store limited billing-related information such as:
          </p>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>Subscription status (active/inactive)</li>
            <li>Plan type and billing dates</li>
            <li>Payment confirmation identifiers</li>
          </ul>
          <p className="mb-4">We do not store full payment card numbers.</p>

          <h3 className="mb-2 mt-6 text-lg font-semibold text-foreground">
            D) Usage and device information (collected automatically)
          </h3>
          <p className="mb-4">When you use the Service, we may automatically collect:</p>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>Device and browser information (device type, operating system, browser type)</li>
            <li>Log data (IP address, access times, pages/screens viewed, app interactions)</li>
            <li>Diagnostics (error reports and crash data, if enabled)</li>
          </ul>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            2) How We Use Information
          </h2>
          <p className="mb-4">We use the information we collect to:</p>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>Provide and maintain the Service (create accounts, authenticate users, enable core features)</li>
            <li>Operate challenges and redemptions (including enforcing participation limits, cooldowns, and eligibility rules)</li>
            <li>Process subscriptions and confirm billing status</li>
            <li>Communicate with you (service updates, transactional messages, support responses)</li>
            <li>Improve and secure the Service (analytics, debugging, abuse prevention, fraud detection)</li>
            <li>Comply with legal obligations and respond to lawful requests</li>
          </ul>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            3) How We Share Information
          </h2>
          <p className="mb-4">
            We do not sell your personal information. We may share information in the following situations:
          </p>

          <h3 className="mb-2 mt-6 text-lg font-semibold text-foreground">A) Service providers</h3>
          <p className="mb-4">
            We share information with trusted vendors that help us operate the Service, such as:
          </p>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>Infrastructure and databases (e.g., Supabase for database, authentication, and related services)</li>
            <li>Payment processors (for subscription billing and payment confirmation)</li>
            <li>Analytics providers (if used) to understand usage and improve performance</li>
            <li>Customer support tools (if used) to respond to requests</li>
          </ul>
          <p className="mb-4">
            These providers are authorized to use information only as needed to provide services to us.
          </p>

          <h3 className="mb-2 mt-6 text-lg font-semibold text-foreground">B) Legal and safety</h3>
          <p className="mb-4">We may disclose information if we believe it is necessary to:</p>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>Comply with applicable laws, regulations, legal process, or lawful government requests</li>
            <li>Enforce our Terms of Service</li>
            <li>Protect the rights, safety, and security of the Company, our users, restaurants, or the public</li>
          </ul>

          <h3 className="mb-2 mt-6 text-lg font-semibold text-foreground">C) Business transfers</h3>
          <p className="mb-4">
            If we are involved in a merger, acquisition, financing, reorganization, or sale of assets, information may be transferred as part of that transaction.
          </p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            4) Data Storage and Security
          </h2>
          <p className="mb-4">
            Your data is stored and processed using Supabase (supabase.com), which provides database, authentication, and related infrastructure. Data may be stored in secure, geographically distributed systems.
          </p>
          <p className="mb-4">
            We use reasonable administrative, technical, and organizational safeguards designed to protect your information. However, no method of transmission or storage is 100% secure, and we cannot guarantee absolute security.
          </p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            5) Data Retention
          </h2>
          <p className="mb-4">
            We retain information for as long as needed to provide the Service and for legitimate business purposes such as:
          </p>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>security and fraud prevention</li>
            <li>recordkeeping and accounting</li>
            <li>enforcing our Terms</li>
            <li>complying with legal requirements</li>
          </ul>
          <p className="mb-4">
            You may request account deletion. We may retain certain information as required or permitted by law or for legitimate operational purposes (for example, maintaining records to prevent abuse or comply with tax/accounting obligations).
          </p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            6) Cookies and Similar Technologies
          </h2>
          <p className="mb-4">We use cookies and similar technologies to:</p>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>keep you signed in and maintain sessions</li>
            <li>remember preferences</li>
            <li>understand how the Service is used (analytics) and improve performance</li>
          </ul>
          <p className="mb-4">
            Essential cookies are required for the Service to function. We may use analytics cookies to improve our product. You can control non-essential cookies through your browser settings. Disabling certain cookies may affect site functionality.
          </p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            7) Your Choices and Rights
          </h2>
          <p className="mb-4">You have choices regarding your information:</p>
          <ul className="mb-4 list-disc space-y-2 pl-5">
            <li>
              <strong>Account information</strong> — You can update certain profile details in your account settings.
            </li>
            <li>
              <strong>Location permissions</strong> — You can enable/disable location access in your device settings.
            </li>
            <li>
              <strong>Marketing</strong> — If we send marketing emails, you can opt out using the unsubscribe link (service/transactional messages may still be sent).
            </li>
          </ul>
          <p className="mb-4">
            Depending on where you live, you may have rights to access, correct, delete, or obtain a copy of your personal information, and to opt out of certain processing in some cases.
          </p>

          <h3 className="mb-2 mt-6 text-lg font-semibold text-foreground">
            Privacy Requests (Access / Delete / Copy)
          </h3>
          <p className="mb-4">
            You may request to access, correct, delete, or obtain a copy of your personal information
            by emailing{' '}
            <a href="mailto:privacy@wanderbite.com" className={linkClass}>
              privacy@wanderbite.com
            </a>
            . To protect your account, we may verify your identity before completing your request.
            We will respond within a reasonable timeframe and consistent with applicable law.
          </p>

          <h3 className="mb-2 mt-6 text-lg font-semibold text-foreground">Appeals</h3>
          <p className="mb-4">
            If we deny your privacy request, you may appeal our decision by emailing{' '}
            <a href="mailto:privacy@wanderbite.com" className={linkClass}>
              privacy@wanderbite.com
            </a>
            {' '}with the subject line &quot;Privacy Request Appeal&quot; and a brief
            explanation of your concern. We will review and respond to appeals within a reasonable
            timeframe and consistent with applicable law.
          </p>
          <p className="mb-4">
            If you are not satisfied with the outcome of an appeal, you may have the right to contact
            your state attorney general or relevant regulator.
          </p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            8) Children&apos;s Privacy
          </h2>
          <p className="mb-4">
            Wanderbite is not intended for individuals under 21 years of age. We do not knowingly collect personal information from anyone under 21. If you believe a person under 21 has provided us information, contact us and we will take appropriate steps.
          </p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            9) Changes to This Policy
          </h2>
          <p className="mb-4">
            We may update this Privacy Policy from time to time. We will update the &quot;Last updated&quot; date when changes are made. Your continued use of the Service after the update means you accept the revised policy.
          </p>

          <h2 className="mb-3 mt-10 text-xl font-semibold tracking-tight text-foreground">
            10) Contact Us
          </h2>
          <p className="mb-4">
            If you have questions about this Privacy Policy or want to exercise your rights, contact us:
          </p>
          <ul className="mb-4 list-none space-y-2 pl-0">
            <li>
              <strong>Privacy:</strong>{' '}
              <a href="mailto:privacy@wanderbite.com" className={linkClass}>
                privacy@wanderbite.com
              </a>
            </li>
            <li>
              <strong>Support:</strong>{' '}
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
            Use of Wanderbite is also subject to our{' '}
            <Link href="/terms" className={linkClass}>
              Terms of Service
            </Link>
            .
          </p>
        </div>
      </article>
    </main>
  );
}
