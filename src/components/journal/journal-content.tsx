import { format } from 'date-fns';
import Link from 'next/link';
import { Star } from 'lucide-react';
import { getBiteNotes, type BiteNoteRow } from '@/app/actions/bite-notes';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { JOURNAL_SAVED_RECIPES_HEADING } from '@/lib/recipes/display';
import { loadJournalSavedRecipeLinks } from '@/lib/recipes/journal-links';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { deriveVisitStatus, visitStatusLabel, type VisitStatus } from '@/lib/visits/visit-status';
import { cn } from '@/lib/utils';

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

async function statusByRedemption(notes: BiteNoteRow[], now: Date): Promise<Map<string, VisitStatus>> {
  const statuses = new Map<string, VisitStatus>();
  if (notes.length === 0) return statuses;
  const admin = getSupabaseAdmin();
  const { data: redemptionRows } = await admin
    .from('redemptions')
    .select('id, status, verified_at, expires_at, challenge_item_id')
    .in(
      'id',
      notes.map((note) => note.redemption_id),
    );
  const redemptions = (redemptionRows ?? []) as {
    id: string;
    status: string | null;
    verified_at: string | null;
    expires_at: string | null;
    challenge_item_id: string | null;
  }[];
  const itemIds = [
    ...new Set(redemptions.flatMap((row) => (row.challenge_item_id ? [row.challenge_item_id] : []))),
  ];
  const itemById = new Map<string, { status: string; redemption_deadline: string | null }>();
  if (itemIds.length > 0) {
    const { data: itemRows } = await admin
      .from('challenge_items')
      .select('id, status, redemption_deadline')
      .in('id', itemIds);
    for (const item of itemRows ?? []) {
      itemById.set(item.id, {
        status: item.status ?? 'assigned',
        redemption_deadline: item.redemption_deadline,
      });
    }
  }
  const redemptionById = new Map(redemptions.map((row) => [row.id, row]));
  for (const note of notes) {
    const redemption = redemptionById.get(note.redemption_id);
    const item = redemption?.challenge_item_id ? itemById.get(redemption.challenge_item_id) : undefined;
    statuses.set(
      note.redemption_id,
      deriveVisitStatus({
        item: {
          status: item?.status ?? 'assigned',
          redemptionDeadline: item?.redemption_deadline ?? null,
        },
        redemption: redemption
          ? {
              status: redemption.status ?? '',
              verifiedAt: redemption.verified_at,
              expiresAt: redemption.expires_at,
            }
          : null,
        note: { note: note.note },
        now,
      }),
    );
  }
  return statuses;
}

export async function JournalContent() {
  const res = await getBiteNotes();
  if (!res.ok) {
    return <p className="text-destructive">{res.error}</p>;
  }

  const notes = res.data;
  const statuses = await statusByRedemption(notes, new Date());
  const savedByRestaurant = await loadJournalSavedRecipeLinks(
    notes.map((note) => note.restaurant_id),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Journal</h2>
        <p className="text-muted-foreground">
          Private Bite Notes from your Wanderbite visits — only you can see these.
        </p>
      </header>

      {notes.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No notes yet</CardTitle>
            <CardDescription>
              After you redeem a challenge, leave a Bite Note from your dashboard to build your
              food journal here.
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
                <CardContent className="space-y-4">
                  <p className="text-sm font-medium" data-visit-status={statuses.get(n.redemption_id)}>
                    {visitStatusLabel(statuses.get(n.redemption_id) ?? 'ready')}
                  </p>
                  {n.note ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {n.note}
                    </p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">No written note</p>
                  )}
                  {(savedByRestaurant[n.restaurant_id] ?? []).length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">
                        {JOURNAL_SAVED_RECIPES_HEADING}
                      </p>
                      <ul className="list-disc space-y-1 pl-4 text-sm">
                        {(savedByRestaurant[n.restaurant_id] ?? []).map((recipe) => (
                          <li key={recipe.id}>
                            <Link
                              href={`/journey#saved-recipe-${recipe.id}`}
                              className="font-medium text-[#E85D26] underline-offset-2 hover:underline"
                            >
                              {recipe.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
