export default function ContactPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl py-12 px-4 md:px-8 prose prose-violet">
        <h1 className="text-3xl font-bold tracking-tight">Contact Us</h1>
        <p className="text-muted-foreground">Last updated: 2/22/2026</p>

        <p className="text-lg text-foreground">Need help? We&apos;re here.</p>

        <h2 className="text-xl font-semibold mt-8">Support</h2>
        <p>
          For account, subscription, challenge, or redemption questions:
        </p>
        <p>
          <a
            href="mailto:support@wanderbite.com"
            className="text-primary underline hover:no-underline"
          >
            support@wanderbite.com
          </a>
        </p>

        <h2 className="text-xl font-semibold mt-8">Privacy</h2>
        <p>
          For privacy requests (access, deletion, or a copy of your data) or
          privacy questions:
        </p>
        <p>
          <a
            href="mailto:privacy@wanderbite.com"
            className="text-primary underline hover:no-underline"
          >
            privacy@wanderbite.com
          </a>
        </p>

        <h2 className="text-xl font-semibold mt-8">Mailing Address</h2>
        <p className="mb-0">Devine Enterprises LLC d/b/a Wanderbite</p>
        <p className="mb-0">5900 Balcones Drive #23572</p>
        <p>Austin, TX 78731, USA</p>

        <h2 className="text-xl font-semibold mt-8">Response Times</h2>
        <p>
          We aim to respond within 2 business days. Response times may be
          longer during holidays or high-volume periods.
        </p>
      </div>
    </main>
  );
}
