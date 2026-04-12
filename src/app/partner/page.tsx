import Link from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Partner Portal',
};

export default function PartnerFallbackPage() {
  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        Partner Portal
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Looking for your partner portal? Contact{' '}
        <a
          href="mailto:support@wanderbite.com"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          support@wanderbite.com
        </a>{' '}
        and we&apos;ll send you your unique login link.
      </p>
      <p className="mt-6 text-xs text-muted-foreground">
        <Link
          href="https://wanderbite.vercel.app"
          className="text-primary underline-offset-4 hover:underline"
        >
          Wanderbite home
        </Link>
      </p>
    </div>
  );
}
