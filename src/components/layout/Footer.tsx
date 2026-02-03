import Link from 'next/link';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row sm:px-6">
        <p className="text-sm text-muted-foreground">
          © {currentYear} Wanderbite. All rights reserved.
        </p>
        <nav className="flex flex-wrap items-center justify-center gap-6">
          <Link
            href="/#how-it-works"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            How it Works
          </Link>
          <Link
            href="/locations"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Locations
          </Link>
          <Link
            href="/pricing"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Log In
          </Link>
        </nav>
      </div>
    </footer>
  );
}
