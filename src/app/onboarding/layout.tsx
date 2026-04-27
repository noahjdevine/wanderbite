import Link from 'next/link';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-3xl items-center justify-center px-4 pt-8">
        <Link href="/" className="inline-flex items-center gap-2" aria-label="Wanderbite home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight">Wanderbite</span>
        </Link>
      </header>
      {children}
    </div>
  );
}

