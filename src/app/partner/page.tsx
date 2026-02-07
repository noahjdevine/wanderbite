import { redirect } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  getPartnerSession,
  getPartnerRedemptionsThisMonth,
} from '@/app/actions/partner-auth';
import { PartnerLoginForm } from './partner-login-form';
import { PartnerDashboard } from './partner-dashboard';

export const dynamic = 'force-dynamic';

export default async function PartnerPage() {
  const session = await getPartnerSession();

  if (session.ok) {
    const stats = await getPartnerRedemptionsThisMonth(session.restaurantId);
    const totalRedemptionsThisMonth =
      stats.ok ? stats.totalRedemptionsThisMonth : 0;

    return (
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-md px-6 py-12">
          <PartnerDashboard
            restaurantName={session.restaurantName}
            totalRedemptionsThisMonth={totalRedemptionsThisMonth}
          />
        </div>
      </main>
    );
  }

  const admin = getSupabaseAdmin();
  const { data: rows } = await admin
    .from('restaurants')
    .select('id, name')
    .eq('status', 'active')
    .order('name');

  const restaurants = (rows ?? []).map((r) => ({
    id: (r as { id: string }).id,
    name: (r as { name: string }).name,
  }));

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-md px-6 py-12">
        <PartnerLoginForm restaurants={restaurants} />
      </div>
    </main>
  );
}
