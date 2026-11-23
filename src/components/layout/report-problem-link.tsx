'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { reportProblemHref } from '@/lib/site-problems/report';

export function ReportProblemLink({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (
    <Link href={reportProblemHref(pathname, search)} className={className} onClick={onNavigate}>
      Report a problem
    </Link>
  );
}

export function ReportProblemLinkSlot({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <Suspense
      fallback={
        <Link href="/report-a-problem" className={className}>
          Report a problem
        </Link>
      }
    >
      <ReportProblemLink className={className} onNavigate={onNavigate} />
    </Suspense>
  );
}
