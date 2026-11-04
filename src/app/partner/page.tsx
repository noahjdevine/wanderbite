import Link from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Partner Portal',
};

export default function PartnerFallbackPage() {
  return (
    <div className="wb-partner-narrow wb-partner-center">
      <h1 className="wb-partner-title">Partner Portal</h1>
      <p className="wb-partner-lede">
        Looking for your partner portal? Contact{' '}
        <a href="mailto:support@wanderbite.com">support@wanderbite.com</a>{' '}
        and we&apos;ll send you your unique login link.
      </p>
      <p className="wb-partner-fine">
        <Link href="https://wanderbite.vercel.app">Wanderbite home</Link>
      </p>
    </div>
  );
}
