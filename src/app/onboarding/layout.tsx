import Link from 'next/link';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="wb-onboarding">
      <header className="wb-onboarding-bar">
        <div className="wb-onboarding-wrap">
          <Link href="/" className="wb-onboarding-logo" aria-label="Wanderbite home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="h-9 w-9" />
            <span>Wanderbite</span>
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
