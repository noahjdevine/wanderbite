import { getBiteNotes, type BiteNoteRow } from '@/app/actions/bite-notes';
import { PassportChrome } from '@/components/passport/passport-chrome';
import { FocusVisitFromHash } from '@/components/notes/focus-visit';
import { VisitNoteRead } from '@/components/notes/visit-note';
import { requireUser } from '@/lib/auth/require-user';
import { JOURNAL_SAVED_RECIPES_HEADING } from '@/lib/recipes/display';
import { loadJournalSavedRecipeLinks } from '@/lib/recipes/journal-links';
import { chicagoVisitDate, JOURNAL_SEGMENT_HREF } from '@/lib/passport/passport-board';
import { getMemberProgress, presentMemberProgress } from '@/lib/progress/get-member-progress';
import { memberHeaderLabel, NEUTRAL_MEMBER_HEADER } from '@/lib/progress/rules';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { unwrapJoin } from '@/lib/supabase/unwrap-join';
import { deriveVisitStatus, visitStatusLabel, type VisitStatus } from '@/lib/visits/visit-status';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Star } from 'lucide-react';

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

type OpenMemory = {
  redemptionId: string;
  restaurantName: string;
  status: VisitStatus;
  verifiedAt: string;
};

async function verifiedVisitsWithoutNotes(
  userId: string,
  notedIds: Set<string>,
  now: Date,
): Promise<{ ok: true; visits: OpenMemory[] } | { ok: false; error: string }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('redemptions')
    .select('id, status, verified_at, expires_at, restaurants(name)')
    .eq('user_id', userId)
    .eq('status', 'verified');
  if (error) return { ok: false, error: error.message };
  const visits: OpenMemory[] = [];
  for (const row of data ?? []) {
    const redemption = row as {
      id: string;
      status: string | null;
      verified_at: string | null;
      expires_at: string | null;
      restaurants: { name: string } | { name: string }[] | null;
    };
    if (notedIds.has(redemption.id) || !redemption.verified_at) continue;
    const status = deriveVisitStatus({
      item: { status: 'redeemed', redemptionDeadline: null },
      redemption: {
        status: redemption.status ?? '',
        verifiedAt: redemption.verified_at,
        expiresAt: redemption.expires_at,
      },
      note: null,
      now,
    });
    if (status !== 'verified') continue;
    visits.push({
      redemptionId: redemption.id,
      restaurantName: unwrapJoin(redemption.restaurants)?.name ?? 'Restaurant',
      status,
      verifiedAt: redemption.verified_at,
    });
  }
  return { ok: true, visits };
}

const JOURNAL_RETURN = '/journey?view=journal';

function statusChipClass(status: VisitStatus): string {
  if (status === 'verified' || status === 'note_added') {
    return 'bg-[#dcfce7] text-[#14532d]';
  }
  if (status === 'code_issued' || status === 'ready') {
    return 'bg-[#fef3c7] text-[#78350f]';
  }
  return 'bg-[#f6f1e8] text-wb-ink';
}

export async function JournalContent() {
  const auth = await requireUser();
  if (!auth.ok) {
    return <p className="text-destructive">{auth.error}</p>;
  }

  const now = new Date();
  const admin = getSupabaseAdmin();
  const [res, progress, profileResult] = await Promise.all([
    getBiteNotes(),
    getMemberProgress(auth.userId, now),
    admin.from('user_profiles').select('full_name').eq('id', auth.userId),
  ]);
  const presented = presentMemberProgress(progress);
  const profileRows = (profileResult.data ?? []) as { full_name: string | null }[];
  const first = memberHeaderLabel(profileRows[0]?.full_name);
  const displayName = first === NEUTRAL_MEMBER_HEADER ? 'Your' : first;
  const pendingVisits = 'error' in progress ? 0 : progress.pendingVisits;

  if (!res.ok) {
    return (
      <PassportChrome
        displayName={displayName}
        segment="timeline"
        progressUnavailable={presented.progressUnavailable}
        verifiedVisits={presented.verifiedVisits}
        uniqueRestaurants={presented.uniqueRestaurants}
        neighborhoods={presented.neighborhoods}
        currentStreak={presented.streak.currentStreak}
        longestStreak={presented.streak.longestStreak}
        pendingVisits={pendingVisits}
        earnedBadges={presented.earnedBadges}
        showFirstBiteLocked={presented.showFirstBiteLocked}
        retryHref={JOURNAL_SEGMENT_HREF}
      >
        <p className="text-destructive">{res.error}</p>
      </PassportChrome>
    );
  }

  const notes = [...res.data].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const [statuses, openMemories] = await Promise.all([
    statusByRedemption(notes, now),
    verifiedVisitsWithoutNotes(
      auth.userId,
      new Set(notes.map((note) => note.redemption_id)),
      now,
    ),
  ]);
  const savedByRestaurant = await loadJournalSavedRecipeLinks(
    notes.map((note) => note.restaurant_id),
  );

  return (
    <PassportChrome
      displayName={displayName}
      segment="timeline"
      progressUnavailable={presented.progressUnavailable}
      verifiedVisits={presented.verifiedVisits}
      uniqueRestaurants={presented.uniqueRestaurants}
      neighborhoods={presented.neighborhoods}
      currentStreak={presented.streak.currentStreak}
      longestStreak={presented.streak.longestStreak}
      pendingVisits={pendingVisits}
      earnedBadges={presented.earnedBadges}
      showFirstBiteLocked={presented.showFirstBiteLocked}
      retryHref={JOURNAL_SEGMENT_HREF}
    >
      <FocusVisitFromHash />
      <header className="space-y-2">
        <h2 className="font-display m-0 text-[30px] text-wb-ink">Timeline</h2>
        <p className="m-0 text-sm text-wb-muted">
          Your dining memories. You choose which ones to share.
        </p>
      </header>

      {openMemories.ok && openMemories.visits.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {openMemories.visits.map((visit) => (
            <li key={visit.redemptionId}>
              <article className="flex flex-col gap-3 rounded-[26px] bg-white p-4 shadow-[0_14px_34px_rgba(42,20,66,0.08)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display m-0 text-[28px] leading-none text-wb-ink">{visit.restaurantName}</h3>
                    <p className="m-0 mt-1 text-[13px] text-wb-muted">
                      {chicagoVisitDate(visit.verifiedAt)?.long ?? ''}
                    </p>
                  </div>
                  <span
                    data-visit-status={visit.status}
                    className={cn(
                      'inline-flex rounded-full px-2.5 py-1 text-xs font-bold',
                      statusChipClass(visit.status),
                    )}
                  >
                    {visitStatusLabel(visit.status)}
                  </span>
                </div>
                <VisitNoteRead
                  redemptionId={visit.redemptionId}
                  status={visit.status}
                  returnTo={JOURNAL_RETURN}
                  note={null}
                />
              </article>
            </li>
          ))}
        </ul>
      ) : null}
      {!openMemories.ok ? <p className="text-destructive">{openMemories.error}</p> : null}

      {notes.length === 0 && (!openMemories.ok || openMemories.visits.length === 0) ? (
        <article className="rounded-[26px] bg-white p-5 shadow-[0_14px_34px_rgba(42,20,66,0.08)]">
          <h3 className="font-display m-0 text-[28px] text-wb-ink">No notes yet</h3>
          <p className="m-0 mt-2 text-sm text-wb-muted">
            After a visit is verified, you can add a memory for that visit.
          </p>
        </article>
      ) : notes.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {notes.map((n) => {
            const status = statuses.get(n.redemption_id) ?? 'ready';
            const when = chicagoVisitDate(n.created_at);
            return (
              <li key={n.id}>
                <article className="flex flex-col gap-3 rounded-[26px] bg-white p-4 shadow-[0_14px_34px_rgba(42,20,66,0.08)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display m-0 text-[28px] leading-none text-wb-ink">{n.restaurant.name}</h3>
                      <p className="m-0 mt-1 text-[13px] text-wb-muted">
                        {when?.long ?? ''}
                        {n.restaurant.address ? ` · ${n.restaurant.address}` : ''}
                      </p>
                    </div>
                    <StarDisplay rating={n.rating} />
                  </div>
                  <span
                    data-visit-status={status}
                    className={cn(
                      'inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-bold',
                      statusChipClass(status),
                    )}
                  >
                    {visitStatusLabel(status)}
                  </span>
                  <VisitNoteRead
                    redemptionId={n.redemption_id}
                    status={status}
                    returnTo={JOURNAL_RETURN}
                    note={{ id: n.id, note: n.note, is_public: n.is_public }}
                  />
                  {(savedByRestaurant[n.restaurant_id] ?? []).length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-wb-ink">{JOURNAL_SAVED_RECIPES_HEADING}</p>
                      <ul className="list-disc space-y-1 pl-4 text-sm">
                        {(savedByRestaurant[n.restaurant_id] ?? []).map((recipe) => (
                          <li key={recipe.id}>
                            <Link
                              href={`/journey#saved-recipe-${recipe.id}`}
                              className="font-medium text-wb-violet underline-offset-2 hover:underline"
                            >
                              {recipe.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      ) : null}
    </PassportChrome>
  );
}
