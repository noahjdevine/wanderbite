import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background">
      <article className="mx-auto max-w-3xl space-y-6 px-4 py-12 sm:px-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">
            Last updated: {new Date().toLocaleDateString('en-US')}
          </p>
        </header>

        <p className="text-muted-foreground">
          Wanderbite respects your privacy. This policy describes what
          information we collect, how we use it, and your choices.
        </p>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Data Collection</h2>
          <p className="text-muted-foreground">
            We collect information you provide directly, including:
          </p>
          <ul className="list-inside list-disc space-y-1 text-muted-foreground">
            <li>
              <strong>Names</strong> — Your display name or full name when you
              create an account or update your profile.
            </li>
            <li>
              <strong>Emails</strong> — Your email address for account creation,
              login, and transactional communications (e.g., booking
              confirmations).
            </li>
            <li>
              <strong>Location / Check-ins</strong> — Location data you choose
              to share, such as check-ins at restaurants or areas you visit, to
              personalize recommendations and show relevant content.
            </li>
          </ul>
          <p className="text-muted-foreground">
            We use this data to operate the service, personalize your
            experience, and communicate with you in accordance with this policy.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Data Storage</h2>
          <p className="text-muted-foreground">
            Your data is stored and processed using{' '}
            <strong>Supabase</strong> (supabase.com). Supabase provides
            database, authentication, and related infrastructure. Data is stored
            in secure, geographically distributed systems. We do not sell your
            personal information. We may share data only as needed to provide
            the service (e.g., with payment processors) or when required by law.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Cookie Usage</h2>
          <p className="text-muted-foreground">
            We use cookies and similar technologies to keep you signed in, remember
            your preferences, and understand how the site is used. Essential
            cookies are required for the app to function. We may also use
            analytics cookies to improve our product. You can control
            non-essential cookies through your browser settings; disabling some
            may affect site functionality.
          </p>
        </section>

        <p className="text-sm text-muted-foreground">
          For more information about how we handle your data or to exercise your
          rights, contact us. Use of Wanderbite is also subject to our{' '}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
