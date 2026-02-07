import { redirect } from 'next/navigation';
import Link from 'next/link';
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
      </div>
    </main>
  );
}
