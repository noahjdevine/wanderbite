import Link from 'next/link';

/** Shown on member pages when an active subscription still lacks a username or address. */
export function IncompleteProfileNotice() {
  return (
    <p
      role="status"
      className="mb-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
    >
      Your username or address is still unfinished.{' '}
      <Link href="/account" className="font-medium text-primary underline underline-offset-2">
        Finish it on your account
      </Link>
      .
    </p>
  );
}
