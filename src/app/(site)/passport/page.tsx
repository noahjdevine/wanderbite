import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Legacy route — Passport stamps live at `/journey?view=passport`. */
export default function PassportPage() {
  redirect('/journey?view=passport');
}
