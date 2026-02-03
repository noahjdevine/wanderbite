import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { Button } from '@/components/ui/button';
import { AdminClient } from '@/app/admin/admin-client';

const SUPER_ADMIN_EMAIL = 'noah@wanderbite.com';

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const email = user.email?.trim().toLowerCase() ?? '';
  if (email !== SUPER_ADMIN_EMAIL) {
    redirect('/');
  }

  const admin = getSupabaseAdmin();
  const { data: rows, error } = await admin
    .from('restaurants')
    .select('id, name, address, description, cuisine_tags, price_range, neighborhood, image_url, verification_code, status')
    .order('name');

  if (error) {
    return (
      <main className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto max-w-4xl">
          <p className="text-destructive">Failed to load restaurants: {error.message}</p>
        </div>
      </main>
    );
  }

  const restaurants = (rows ?? []).map((r) => ({
    id: (r as { id: string }).id,
    name: (r as { name: string }).name,
    address: (r as { address: string | null }).address,
    description: (r as { description: string | null }).description ?? null,
    cuisine_tags: (r as { cuisine_tags: string[] | null }).cuisine_tags,
    price_range: (r as { price_range: string | null }).price_range ?? null,
    neighborhood: (r as { neighborhood: string | null }).neighborhood ?? null,
    image_url: (r as { image_url: string | null }).image_url ?? null,
    verification_code: (r as { verification_code: string | null }).verification_code ?? null,
    status: (r as { status: string }).status,
  }));

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary">
              Super Admin
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage partner restaurants. Access restricted.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/">Back to app</Link>
          </Button>
        </div>
        <AdminClient restaurants={restaurants} />
      </div>
    </main>
  );
}
