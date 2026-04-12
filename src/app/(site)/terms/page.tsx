import Link from 'next/link';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto py-12 px-4 md:px-8 prose prose-violet">
        <h1 className="text-3xl font-bold tracking-tight">Wanderbite Terms of Service</h1>
        <p className="text-muted-foreground">Last updated: 2/22/2026</p>

        <p>
          Welcome to Wanderbite (&quot;Wanderbite,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), operated by Devine Enterprises LLC d/b/a Wanderbite (&quot;Company&quot;). These Terms of Service (&quot;Terms&quot;) govern your access to and use of the Wanderbite website, mobile applications, and related services (collectively, the &quot;Service&quot;). By accessing or using the Service, you agree to these Terms and our Privacy Policy. If you do not agree, do not use the Service.
        </p>

        <h2>1) Eligibility</h2>
        <p>
          You must be at least 21 years old to create an account and use the Service. The Service may feature dining experiences that include alcohol and we comply with applicable laws regarding alcohol promotion and age verification. By using the Service, you represent and warrant that you meet the age requirement. We may request age verification and may suspend or terminate accounts that do not comply.
        </p>

        <h2>2) Account Registration and Security</h2>
        <p>You may need to create an account to use parts of the Service. You agree to:</p>
        <ul>
          <li>Provide accurate, current information and keep it updated.</li>
          <li>Maintain the confidentiality of your login credentials.</li>
          <li>Notify us promptly of any unauthorized use of your account.</li>
        </ul>
        <p>You are responsible for all activity that occurs under your account.</p>

        <h2>3) How Wanderbite Works</h2>
        <p>Wanderbite is designed to help you discover participating restaurants through monthly &quot;challenges.&quot;</p>
        <p>Monthly benefits (default plan):</p>
        <ul>
          <li>2 challenges per month</li>
          <li>1 swap per month (allows you to swap one assigned challenge)</li>
        </ul>
        <p>Challenges and swaps reset monthly. Unused challenges and swaps do not roll over unless we explicitly state otherwise within the Service.</p>

        <h2>4) Restaurant Discounts and Redemption Rules</h2>
        <p>Participating restaurants may offer discounts to eligible Wanderbite users. Unless otherwise stated in the Service, the default discount terms are:</p>
        <ul>
          <li><strong>Discount:</strong> $10 off your bill</li>
          <li><strong>Minimum spend:</strong> $40 or more (calculated before tax and tip)</li>
          <li><strong>No stacking:</strong> Discount cannot be combined with other offers, coupons, or promotions unless the restaurant explicitly allows it.</li>
          <li><strong>In-person confirmation required:</strong> Redemption requires in-person confirmation at the restaurant at the time of purchase, using the method shown in the Service.</li>
        </ul>
        <p><strong>Important:</strong> Discounts are offered by restaurants and are subject to restaurant policies, availability, and applicable law. Restaurants may change hours, menus, participation, and discount availability at any time.</p>

        <h2>5) Cooldowns and Participation Limits (Anti-Abuse Rules)</h2>
        <p>To help distribute visits fairly among restaurants and discourage misuse, we enforce participation limits:</p>
        <ul>
          <li><strong>Restaurant cooldown:</strong> After you redeem a discount at a restaurant, you may not redeem another discount at the same restaurant for 6 months.</li>
          <li><strong>Annual cap:</strong> You may redeem at the same restaurant a maximum of 2 times in any rolling 12-month period.</li>
        </ul>
        <p>We may apply additional safeguards to prevent fraud or abuse, including limiting eligibility, requiring additional verification, or suspending accounts.</p>

        <h2>6) Subscriptions, Billing, and Cancellation</h2>
        <p>If you subscribe to a paid plan, you authorize us (and our payment processor) to charge the subscription fee and any applicable taxes on a recurring basis.</p>
        <p><strong>Billing:</strong></p>
        <ul>
          <li>Subscriptions are billed at $15 per month (unless a different price is displayed at checkout).</li>
          <li>Your subscription renews automatically until canceled.</li>
        </ul>
        <p><strong>Cancellation:</strong></p>
        <ul>
          <li>You may cancel anytime through your account settings or by contacting support.</li>
          <li>Cancellation takes effect at the end of your current billing period, and you will retain access to subscription benefits through that period.</li>
        </ul>
        <p><strong>Refunds:</strong></p>
        <ul>
          <li>No refunds are provided for partial billing periods.</li>
          <li>We do not provide refunds for unused challenges, swaps, or unredeemed discounts during a billing period.</li>
        </ul>
        <p><strong>Price changes:</strong></p>
        <p>We may change subscription pricing with reasonable notice (e.g., by email or in-app notice). Continued use after the effective date constitutes acceptance of the updated price.</p>

        <h2>7) Rewards, Points, Badges, and Levels</h2>
        <p>The Service may include points, badges, levels, or other promotional features (&quot;Rewards&quot;). Rewards:</p>
        <ul>
          <li>Have no cash value and are not redeemable for cash.</li>
          <li>Are non-transferable and may not be sold, traded, or bartered.</li>
          <li>May be modified, suspended, or discontinued at any time.</li>
          <li>May be adjusted or reversed if we believe there has been fraud, abuse, or an error.</li>
        </ul>

        <h2>8) Restaurants Are Third Parties</h2>
        <p>Restaurants are independent third parties. Wanderbite does not own, operate, or control restaurants and does not guarantee the quality, safety, pricing, availability, service, or experience provided by any restaurant.</p>
        <p>You agree that any issues related to a restaurant experience (including food quality, allergens, service, pricing disputes, or health and safety concerns) are between you and the restaurant.</p>

        <h2>9) Prohibited Conduct</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Create more than one account per person or otherwise circumvent account limits.</li>
          <li>Misrepresent your identity, age, or eligibility.</li>
          <li>Attempt to redeem discounts fraudulently or outside the redemption flow.</li>
          <li>Exploit the Service (including through bots, scraping, automation, or abuse of swap/redemption logic).</li>
          <li>Interfere with the Service&apos;s security or functionality.</li>
          <li>Use the Service for unlawful purposes.</li>
        </ul>
        <p>We may investigate suspected violations and take action, including suspension or termination.</p>

        <h2>10) Intellectual Property</h2>
        <p>The Service, including its content, design, logos, text, graphics, software, and functionality, is owned by the Company or its licensors and is protected by intellectual property laws. You are granted a limited, non-exclusive, non-transferable, revocable license to use the Service for personal, non-commercial use in accordance with these Terms.</p>

        <h2>11) Disclaimers</h2>
        <p>The Service is provided &quot;as is&quot; and &quot;as available.&quot; To the fullest extent permitted by law, we disclaim all warranties, express or implied, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or free of harmful components.</p>

        <h2>12) Limitation of Liability</h2>
        <p>To the fullest extent permitted by law, the Company and its affiliates, officers, employees, and agents will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, or data, arising from or related to your use of (or inability to use) the Service, even if we have been advised of the possibility of such damages.</p>
        <p>Our total liability for any claims arising out of or related to these Terms or the Service will not exceed the amount you paid to Wanderbite in the twelve (12) months preceding the event giving rise to the claim.</p>
        <p>Some jurisdictions do not allow certain limitations, so some of the above may not apply to you. In such cases, liability is limited to the maximum extent permitted by law.</p>

        <h2>13) Indemnification</h2>
        <p>You agree to indemnify and hold harmless the Company and its affiliates, officers, employees, and agents from and against any claims, liabilities, damages, losses, and expenses (including reasonable attorneys&apos; fees) arising out of or related to: (a) your use of the Service, (b) your violation of these Terms, or (c) your violation of any law or rights of any third party, including restaurants.</p>

        <h2>14) Suspension and Termination</h2>
        <p>We may suspend or terminate your access to the Service at any time if we believe you have violated these Terms, engaged in fraud or abuse, or created risk for the Company, restaurants, or other users.</p>
        <p>You may stop using the Service at any time. If your subscription is canceled, your access to subscription benefits ends at the end of your current billing period.</p>

        <h2>15) Changes to the Service or Terms</h2>
        <p>We may update the Service and these Terms from time to time. If we make material changes, we will provide notice by updating the &quot;Last updated&quot; date and, when appropriate, providing additional notice (e.g., email or in-app notice). Your continued use of the Service after changes become effective means you accept the updated Terms.</p>

        <h2>16) Governing Law and Venue</h2>
        <p>These Terms are governed by the laws of the State of Texas, without regard to conflict of law principles. You agree that any dispute arising out of or relating to these Terms or the Service will be brought exclusively in the state or federal courts located in Collin County, Texas, and you consent to the jurisdiction of those courts.</p>

        <h2>17) Contact Us</h2>
        <p>If you have questions about these Terms, contact us at:</p>
        <ul className="list-none space-y-1">
          <li><strong>Support:</strong> support@wanderbite.com</li>
          <li><strong>Privacy:</strong> privacy@wanderbite.com</li>
          <li><strong>Company:</strong> Devine Enterprises LLC d/b/a Wanderbite</li>
          <li><strong>Mailing Address:</strong> 5900 Balcones Drive #23572, Austin, TX 78731, USA</li>
        </ul>

        <p className="mt-8 text-sm text-muted-foreground">
          By using Wanderbite, you also agree to our{' '}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
