import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Legacy route: redirect to the canonical challenges page.
 */
export default function DashboardPage() {
  redirect('/challenges');
}
