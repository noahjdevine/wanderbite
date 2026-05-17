import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Legacy route — Journal lives in the My Journey hub. */
export default function JournalPage() {
  redirect('/journey?view=journal');
}
