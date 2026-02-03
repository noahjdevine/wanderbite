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

  type RestaurantRow = {
    id: string;
    name: string;
    address: string | null;
    description: string | null;
    cuisine_tags: string[] | null;
    price_range: string | null;
    neighborhood: string | null;
    image_url: string | null;
    verification_code: string | null;
    status: string;
  };
  const restaurants = (rows ?? []).map((r) => {
    const row = r as unknown as RestaurantRow;
    return {
      id: row.id,
      name: row.name,
      address: row.address,
      description: row.description ?? null,
      cuisine_tags: row.cuisine_tags,
      price_range: row.price_range ?? null,
      neighborhood: row.neighborhood ?? null,
      image_url: row.image_url ?? null,
      verification_code: row.verification_code ?? null,
      status: row.status,
    };
  });

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
