import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto py-12 px-4 md:px-8 prose prose-violet">
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy (Wanderbite)</h1>
        <p className="text-muted-foreground">Last updated: 2/22/2026</p>

        <p>
          Wanderbite (&quot;Wanderbite,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is operated by Devine Enterprises LLC d/b/a Wanderbite (&quot;Company&quot;). We respect your privacy. This Privacy Policy explains what information we collect, how we use it, how we share it, and the choices you have.
        </p>
        <p>By using Wanderbite, you agree to this Privacy Policy.</p>

        <h2>1) Information We Collect</h2>

        <h3>A) Information you provide directly</h3>
        <p>We collect information you choose to provide, including:</p>
        <ul>
          <li><strong>Name</strong> — Your display name and/or full name when you create an account or update your profile.</li>
          <li><strong>Email</strong> — Your email address for account creation, login, and transactional communications (e.g., subscription and redemption confirmations).</li>
          <li><strong>Preferences</strong> — Information you choose to share such as dietary preferences or allergy-related preferences (if you provide them).</li>
          <li><strong>Support communications</strong> — Information you include when contacting support (messages, screenshots, or other details).</li>
        </ul>

        <h3>B) Location and check-ins</h3>
        <p>We may collect location-related information in the following ways:</p>
        <ul>
          <li><strong>Check-ins / redemptions</strong> — When you choose to check in or redeem a challenge at a restaurant, we record the restaurant and the time of the activity.</li>
          <li><strong>Approximate location (optional)</strong> — If you allow it, we may use approximate location information (such as city/area or device-derived approximation) to show restaurants and experiences that are relevant to where you are.</li>
        </ul>
        <p>We do not require you to share precise GPS location to use the Service unless the app explicitly asks and you grant permission. You can manage location permissions in your device settings.</p>

        <h3>C) Subscription and transaction information</h3>
        <p>If you subscribe, payments are handled by third-party payment processors. We receive and store limited billing-related information such as:</p>
        <ul>
          <li>Subscription status (active/inactive)</li>
          <li>Plan type and billing dates</li>
          <li>Payment confirmation identifiers</li>
        </ul>
        <p>We do not store full payment card numbers.</p>

        <h3>D) Usage and device information (collected automatically)</h3>
        <p>When you use the Service, we may automatically collect:</p>
        <ul>
          <li>Device and browser information (device type, operating system, browser type)</li>
          <li>Log data (IP address, access times, pages/screens viewed, app interactions)</li>
          <li>Diagnostics (error reports and crash data, if enabled)</li>
        </ul>

        <h2>2) How We Use Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>Provide and maintain the Service (create accounts, authenticate users, enable core features)</li>
          <li>Operate challenges and redemptions (including enforcing participation limits, cooldowns, and eligibility rules)</li>
          <li>Process subscriptions and confirm billing status</li>
          <li>Communicate with you (service updates, transactional messages, support responses)</li>
          <li>Improve and secure the Service (analytics, debugging, abuse prevention, fraud detection)</li>
          <li>Comply with legal obligations and respond to lawful requests</li>
        </ul>

        <h2>3) How We Share Information</h2>
        <p>We do not sell your personal information. We may share information in the following situations:</p>

        <h3>A) Service providers</h3>
        <p>We share information with trusted vendors that help us operate the Service, such as:</p>
        <ul>
          <li>Infrastructure and databases (e.g., Supabase for database, authentication, and related services)</li>
          <li>Payment processors (for subscription billing and payment confirmation)</li>
          <li>Analytics providers (if used) to understand usage and improve performance</li>
          <li>Customer support tools (if used) to respond to requests</li>
        </ul>
        <p>These providers are authorized to use information only as needed to provide services to us.</p>

        <h3>B) Legal and safety</h3>
        <p>We may disclose information if we believe it is necessary to:</p>
        <ul>
          <li>Comply with applicable laws, regulations, legal process, or lawful government requests</li>
          <li>Enforce our Terms of Service</li>
          <li>Protect the rights, safety, and security of the Company, our users, restaurants, or the public</li>
        </ul>

        <h3>C) Business transfers</h3>
        <p>If we are involved in a merger, acquisition, financing, reorganization, or sale of assets, information may be transferred as part of that transaction.</p>

        <h2>4) Data Storage and Security</h2>
        <p>Your data is stored and processed using Supabase (supabase.com), which provides database, authentication, and related infrastructure. Data may be stored in secure, geographically distributed systems.</p>
        <p>We use reasonable administrative, technical, and organizational safeguards designed to protect your information. However, no method of transmission or storage is 100% secure, and we cannot guarantee absolute security.</p>

        <h2>5) Data Retention</h2>
        <p>We retain information for as long as needed to provide the Service and for legitimate business purposes such as:</p>
        <ul>
          <li>security and fraud prevention</li>
          <li>recordkeeping and accounting</li>
          <li>enforcing our Terms</li>
          <li>complying with legal requirements</li>
        </ul>
        <p>You may request account deletion. We may retain certain information as required or permitted by law or for legitimate operational purposes (for example, maintaining records to prevent abuse or comply with tax/accounting obligations).</p>

        <h2>6) Cookies and Similar Technologies</h2>
        <p>We use cookies and similar technologies to:</p>
        <ul>
          <li>keep you signed in and maintain sessions</li>
          <li>remember preferences</li>
          <li>understand how the Service is used (analytics) and improve performance</li>
        </ul>
        <p>Essential cookies are required for the Service to function. We may use analytics cookies to improve our product. You can control non-essential cookies through your browser settings. Disabling certain cookies may affect site functionality.</p>

        <h2>7) Your Choices and Rights</h2>
        <p>You have choices regarding your information:</p>
        <ul>
          <li><strong>Account information</strong> — You can update certain profile details in your account settings.</li>
          <li><strong>Location permissions</strong> — You can enable/disable location access in your device settings.</li>
          <li><strong>Marketing</strong> — If we send marketing emails, you can opt out using the unsubscribe link (service/transactional messages may still be sent).</li>
        </ul>
        <p>Depending on where you live, you may have rights to access, correct, delete, or obtain a copy of your personal information, and to opt out of certain processing in some cases.</p>

        <h3>Privacy Requests (Access / Delete / Copy)</h3>
        <p>
          You may request to access, correct, delete, or obtain a copy of your personal information
          by emailing{' '}
          <a
            href="mailto:privacy@wanderbite.com"
            className="text-primary underline hover:no-underline"
          >
            privacy@wanderbite.com
          </a>
          . To protect your account, we may verify your identity before completing your request.
          We will respond within a reasonable timeframe and consistent with applicable law.
        </p>

        <h3>Appeals</h3>
        <p>
          If we deny your privacy request, you may appeal our decision by emailing{' '}
          <a
            href="mailto:privacy@wanderbite.com"
            className="text-primary underline hover:no-underline"
          >
            privacy@wanderbite.com
          </a>
          {' '}with the subject line &quot;Privacy Request Appeal&quot; and a brief
          explanation of your concern. We will review and respond to appeals within a reasonable
          timeframe and consistent with applicable law.
        </p>
        <p>
          If you are not satisfied with the outcome of an appeal, you may have the right to contact
          your state attorney general or relevant regulator.
        </p>

        <h2>8) Children&apos;s Privacy</h2>
        <p>Wanderbite is not intended for individuals under 21 years of age. We do not knowingly collect personal information from anyone under 21. If you believe a person under 21 has provided us information, contact us and we will take appropriate steps.</p>

        <h2>9) Changes to This Policy</h2>
        <p>We may update this Privacy Policy from time to time. We will update the &quot;Last updated&quot; date when changes are made. Your continued use of the Service after the update means you accept the revised policy.</p>

        <h2>10) Contact Us</h2>
        <p>If you have questions about this Privacy Policy or want to exercise your rights, contact us:</p>
        <ul className="list-none space-y-1">
          <li><strong>Privacy:</strong> privacy@wanderbite.com</li>
          <li><strong>Support:</strong> support@wanderbite.com</li>
          <li><strong>Company:</strong> Devine Enterprises LLC d/b/a Wanderbite</li>
          <li><strong>Mailing Address:</strong> 5900 Balcones Drive #23572, Austin, TX 78731, USA</li>
        </ul>

        <p className="mt-8 text-sm text-muted-foreground">
          Use of Wanderbite is also subject to our{' '}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
