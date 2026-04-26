import { redirect } from 'next/navigation';
import { format } from 'date-fns';
import { Star } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getBiteNotes } from '@/app/actions/bite-notes';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            'size-5',
            n <= rating
              ? 'fill-amber-400 text-amber-400'
              : 'fill-transparent text-muted-foreground/35'
          )}
        />
      ))}
    </div>
  );
}

export default async function JournalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/signin?redirectTo=/journal');
  }

  const res = await getBiteNotes(user.id);
  if (!res.ok) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <p className="text-destructive">{res.error}</p>
      </main>
    );
  }

  const notes = res.data;

  return (
    <main className="mx-auto max-w-2xl px-4 py-16 md:px-6">
      <header className="mb-10 space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Journal</h1>
        <p className="text-muted-foreground">
          Private Bite Notes from your Wanderbite visits — only you can see these.
        </p>
      </header>

      {notes.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No notes yet</CardTitle>
            <CardDescription>
              After you redeem a challenge, leave a Bite Note from your dashboard to
              build your food journal here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-4">
          {notes.map((n) => (
            <li key={n.id}>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{n.restaurant.name}</CardTitle>
                      <CardDescription>
                        {format(new Date(n.created_at), 'MMMM d, yyyy')}
                        {n.restaurant.address ? ` · ${n.restaurant.address}` : ''}
                      </CardDescription>
                    </div>
                    <StarDisplay rating={n.rating} />
                  </div>
                </CardHeader>
                <CardContent>
                  {n.note ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {n.note}
                    </p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">No written note</p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
