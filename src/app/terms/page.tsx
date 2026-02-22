import Link from 'next/link';

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background">
      <article className="mx-auto max-w-3xl space-y-6 px-4 py-12 sm:px-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
          <p className="text-sm text-muted-foreground">
            Last updated: {new Date().toLocaleDateString('en-US')}
          </p>
        </header>

        <p className="text-muted-foreground">
          Welcome to Wanderbite. By accessing or using our services, you agree to
          be bound by these Terms of Service. Please read them carefully.
        </p>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">User Eligibility</h2>
          <p className="text-muted-foreground">
            You must be at least <strong>21 years of age</strong> to create an
            account and use Wanderbite. Our platform may feature dining
            experiences that include alcohol, and we comply with applicable
            local laws regarding alcohol promotion and age verification. By
            signing up, you represent that you meet this age requirement. We
            reserve the right to verify age and to suspend or terminate accounts
            that do not comply.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Subscription & Cancellation Policies
          </h2>
          <p className="text-muted-foreground">
            If you subscribe to a paid plan, you will be billed according to the
            plan you select. You may cancel your subscription at any time from
            your account settings or by contacting support. Cancellation will
            take effect at the end of your current billing period. No refunds
            will be provided for partial billing periods. We may change pricing
            with reasonable notice; continued use after changes constitutes
            acceptance.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Limitation of Liability</h2>
          <p className="text-muted-foreground">
            To the fullest extent permitted by law, Wanderbite and its
            affiliates, officers, and employees shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages,
            or any loss of profits or data, arising from your use of our
            services. Our total liability for any claims related to these terms
            or the service shall not exceed the amount you paid us in the twelve
            (12) months preceding the claim. Some jurisdictions do not allow
            certain limitations; in such cases, our liability is limited to the
            maximum permitted by law.
          </p>
        </section>

        <p className="text-sm text-muted-foreground">
          If you have questions about these terms, please contact us. By using
          Wanderbite, you also agree to our{' '}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
