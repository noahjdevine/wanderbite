import { redirect } from 'next/navigation';
import Link from 'next/link';
import { HelpCircle, LogOut, Settings, CreditCard } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { Button } from '@/components/ui/button';
import { ProfileForm } from './profile-form';

export const dynamic = 'force-dynamic';

const DIETARY_OPTIONS = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'gluten_free', label: 'Gluten-Free' },
  { value: 'halal', label: 'Halal' },
] as const;

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('user_profiles')
    .select('full_name, email, username, phone_number, address, dietary_flags')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    redirect('/onboarding');
  }

  const p = profile as {
    full_name: string | null;
    email: string | null;
    username: string | null;
    phone_number: string | null;
    address: string | null;
    dietary_flags: string[] | null;
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="border-b py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6">
          <h1 className="text-xl font-semibold">Wanderbite</h1>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/challenges">Challenges</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/journey">My Journey</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-8 p-6">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Profile
        </h2>
        <p className="text-muted-foreground">
          Update your name, contact info, and dietary preferences.
        </p>
        <ProfileForm
          initial={{
            full_name: p.full_name ?? '',
            email: p.email ?? '',
            username: p.username ?? '',
            phone_number: p.phone_number ?? '',
            address: p.address ?? '',
            dietary_flags: p.dietary_flags ?? [],
          }}
          dietaryOptions={DIETARY_OPTIONS}
        />

        <div className="mt-8 space-y-4">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider px-1">
            Menu
          </h3>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
            <Link href="/billing" className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <CreditCard className="size-5 text-slate-400" />
                <span className="font-medium text-slate-700">Subscription & Billing</span>
              </div>
            </Link>

            <Link href="/how-it-works" className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <HelpCircle className="size-5 text-slate-400" />
                <span className="font-medium text-slate-700">How it Works</span>
              </div>
            </Link>

            <Link href="/settings" className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <Settings className="size-5 text-slate-400" />
                <span className="font-medium text-slate-700">Account Settings</span>
              </div>
            </Link>
          </div>

          <form action="/auth/signout" method="post">
            <button className="w-full flex items-center justify-center gap-2 p-4 mt-6 text-red-600 font-medium bg-red-50 rounded-xl hover:bg-red-100 transition-colors" type="submit">
              <LogOut className="size-5" />
              Sign Out
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
