'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { addRestaurant, deleteRestaurant } from '@/app/admin/actions';
import {
  enrichAllRestaurants,
  enrichSingleRestaurant,
} from '@/app/admin/actions-places';
import { toast } from 'sonner';

type RestaurantRow = {
  id: string;
  name: string;
  address: string | null;
  description: string | null;
  cuisine_tags: string[] | null;
  price_range: string | null;
  neighborhood: string | null;
  image_url: string | null;
  google_photo_url: string | null;
  verification_code: string | null;
  pin: string | null;
  status: string;
};

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  username: string;
  subscription_status: string;
};

type AdminClientProps = {
  restaurants: RestaurantRow[];
  users: UserRow[];
};

const PRICE_OPTIONS = ['$', '$$', '$$$', '$$$$'];

export function AdminClient({ restaurants: initialRestaurants, users }: AdminClientProps) {
  const router = useRouter();
  const [restaurants, setRestaurants] = useState(initialRestaurants);
  const [adding, setAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [enrichingBulk, setEnrichingBulk] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);

  useEffect(() => {
    setRestaurants(initialRestaurants);
  }, [initialRestaurants]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    setAdding(true);
    try {
      const result = await addRestaurant(formData);
      if (result.ok) {
        toast.success('Restaurant added.');
        form.reset();
        router.refresh();
        return;
      }
      toast.error(result.error);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteId(null);
    setDeleting(true);
    try {
      const result = await deleteRestaurant(id);
      if (result.ok) {
        setRestaurants((prev) => prev.filter((r) => r.id !== id));
        toast.success('Restaurant deleted.');
        router.refresh();
        return;
      }
      toast.error(result.error);
    } finally {
      setDeleting(false);
    }
  }

  async function handleEnrichAll() {
    setEnrichingBulk(true);
    try {
      const result = await enrichAllRestaurants();
      if (!result.ok) {
        toast.error(result.error ?? 'Could not enrich restaurants.');
        return;
      }
      toast.success(`Updated ${result.updated} restaurants, ${result.failed} failed`);
      router.refresh();
    } finally {
      setEnrichingBulk(false);
    }
  }

  async function handleRefreshPhoto(id: string) {
    setEnrichingId(id);
    try {
      const result = await enrichSingleRestaurant(id);
      if (result.ok) {
        setRestaurants((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, google_photo_url: result.photoUrl ?? r.google_photo_url }
              : r
          )
        );
        toast.success('Photo updated.');
        router.refresh();
        return;
      }
      toast.error(result.error ?? 'Could not refresh photo.');
    } finally {
      setEnrichingId(null);
    }
  }

  return (
    <div className="space-y-10">
      <Card className="border-violet-200">
        <CardHeader>
          <CardTitle className="text-primary">Add Restaurant</CardTitle>
          <CardDescription>Insert a new partner restaurant.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="name" className="mb-1 block text-sm font-medium">
                Name *
              </label>
              <input
                id="name"
                name="name"
                required
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="description" className="mb-1 block text-sm font-medium">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={2}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="address" className="mb-1 block text-sm font-medium">
                Address
              </label>
              <input
                id="address"
                name="address"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="cuisine" className="mb-1 block text-sm font-medium">
                Cuisine (comma-separated)
              </label>
              <input
                id="cuisine"
                name="cuisine"
                placeholder="bbq, american, casual"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="price_range" className="mb-1 block text-sm font-medium">
                Price Range
              </label>
              <select
                id="price_range"
                name="price_range"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <option value="">—</option>
                {PRICE_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="neighborhood" className="mb-1 block text-sm font-medium">
                Neighborhood
              </label>
              <input
                id="neighborhood"
                name="neighborhood"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="image_url" className="mb-1 block text-sm font-medium">
                Image URL
              </label>
              <input
                id="image_url"
                name="image_url"
                type="url"
                placeholder="https://..."
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="verification_code" className="mb-1 block text-sm font-medium">
                Verification Code (for partner redemption)
              </label>
              <input
                id="verification_code"
                name="verification_code"
                placeholder="Optional"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="pin" className="mb-1 block text-sm font-medium">
                Partner PIN (for /partner portal login)
              </label>
              <input
                id="pin"
                name="pin"
                type="password"
                placeholder="e.g. 4–6 digits"
                autoComplete="off"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={adding}>
                {adding ? 'Adding…' : 'Add Restaurant'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-violet-200">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="text-primary">Restaurant List</CardTitle>
            <CardDescription>
              All partner restaurants. PIN used for Partner Portal login.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="shrink-0"
            disabled={enrichingBulk}
            onClick={() => void handleEnrichAll()}
          >
            {enrichingBulk
              ? 'Fetching photos... this may take a moment'
              : 'Enrich Restaurant Photos'}
          </Button>
        </CardHeader>
        <CardContent>
          {restaurants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No restaurants yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Neighborhood</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>PIN set</TableHead>
                    <TableHead className="min-w-[180px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {restaurants.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {r.name}
                          {r.google_photo_url?.trim() ? (
                            <span className="rounded-full bg-emerald-600/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                              Photo ✓
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                        {r.address ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm">{r.neighborhood ?? '—'}</TableCell>
                      <TableCell className="text-sm">{r.price_range ?? '—'}</TableCell>
                      <TableCell className="text-sm">{r.pin ? 'Yes' : '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={deleting || enrichingBulk || enrichingId === r.id}
                            onClick={() => void handleRefreshPhoto(r.id)}
                          >
                            {enrichingId === r.id ? 'Refreshing…' : 'Refresh Photo'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setDeleteId(r.id)}
                            disabled={deleting || enrichingBulk}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-violet-200">
        <CardHeader>
          <CardTitle className="text-primary">User List</CardTitle>
          <CardDescription>All users (subscribers).</CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Subscription</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.email}</TableCell>
                      <TableCell className="text-sm">{u.full_name}</TableCell>
                      <TableCell className="text-sm">{u.username}</TableCell>
                      <TableCell className="text-sm">{u.subscription_status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete restaurant?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the restaurant and its offer. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && handleDelete(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
