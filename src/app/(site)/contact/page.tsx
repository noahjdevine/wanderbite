export default function ContactPage() {
  return (
    <main>
      <article>
        <header>
          <h1>Contact Us</h1>
          <p>Last updated: 2/22/2026</p>
        </header>
        <div>
          <p>Need help? We&apos;re here.</p>

          <h2>Support</h2>
          <p>For account, subscription, challenge, or redemption questions:</p>
          <p>
            <a href="mailto:support@wanderbite.com">support@wanderbite.com</a>
          </p>

          <h2>Privacy</h2>
          <p>
            For privacy requests (access, deletion, or a copy of your data) or
            privacy questions:
          </p>
          <p>
            <a href="mailto:privacy@wanderbite.com">privacy@wanderbite.com</a>
          </p>

          <h2>Mailing Address</h2>
          <div className="wb-reading-address">
            <p>Devine Enterprises LLC d/b/a Wanderbite</p>
            <p>5900 Balcones Drive #23572</p>
            <p>Austin, TX 78731, USA</p>
          </div>

          <h2>Response Times</h2>
          <p>
            We aim to respond within 2 business days. Response times may be
            longer during holidays or high-volume periods.
          </p>
        </div>
      </article>
    </main>
  );
}
