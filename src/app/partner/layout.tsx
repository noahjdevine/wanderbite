const MARKETING_SITE_URL = "https://wanderbite.vercel.app";
const SUPPORT_EMAIL = "support@wanderbite.com";

export default function PartnerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="wb-partner">
      <header className="wb-partner-bar">
        <div className="wb-partner-bar-inner">
          <a
            href={MARKETING_SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="wb-partner-logo"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/Wanderbite-logo.svg"
              alt="Wanderbite"
              width={120}
              height={32}
            />
          </a>

          <p className="wb-partner-kicker">Partner Portal</p>

          <a href={`mailto:${SUPPORT_EMAIL}`} className="wb-partner-help">
            Need help? {SUPPORT_EMAIL}
          </a>
        </div>
      </header>

      <main className="wb-partner-main">{children}</main>
    </div>
  );
}
