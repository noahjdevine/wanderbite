import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Legacy route — Passport lives in the My Journey hub. */
export default function PassportPage() {
  redirect('/journey?view=passport');
}
