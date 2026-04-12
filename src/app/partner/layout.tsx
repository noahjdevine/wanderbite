const MARKETING_SITE_URL = "https://wanderbite.vercel.app";
const SUPPORT_EMAIL = "support@wanderbite.com";

export default function PartnerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="shrink-0 border-b border-border/70 bg-background">
        <div className="relative mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a
            href={MARKETING_SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 flex shrink-0 items-center opacity-90 transition-opacity hover:opacity-100"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/Wanderbite-logo.svg"
              alt="Wanderbite"
              width={120}
              height={32}
              className="h-7 w-auto sm:h-8"
            />
          </a>

          <p className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 text-sm font-medium tracking-wide text-muted-foreground sm:block">
            Partner Portal
          </p>

          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="relative z-10 max-w-[52%] shrink-0 text-right text-xs leading-snug text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline sm:max-w-none sm:text-sm"
          >
            Need help? {SUPPORT_EMAIL}
          </a>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
