'use client';

import { useState } from 'react';
import { Bea } from '@/components/bea/Bea';
import { MemoryEntryLink } from '@/components/notes/memory-entry';
import { NotePrivacyControl } from '@/components/notes/note-privacy';
import { RestaurantPhoto } from '@/components/restaurants/restaurant-photo';
import { noteEditorHref } from '@/lib/notes/note-rules';
import { offerPublicToggle } from '@/lib/passport/passport-board';
import type { VisitStatus } from '@/lib/visits/visit-status';

const PASSPORT_RETURN = '/journey?view=passport';

type PassportMemoryCardProps = {
  name: string;
  meta: string;
  note: string | null;
  rating: number | null;
  photoLabel: string;
  restaurantId: string;
  imageUrl: string | null;
  googlePlaceId: string | null;
  redemptionId: string;
  status: VisitStatus;
  noteId?: string;
  isPublic?: boolean;
  redemptionStatus: string | null;
  verifiedAt: string | null;
};

export function PassportMemoryCard({
  name,
  meta,
  note,
  rating,
  photoLabel,
  restaurantId,
  imageUrl,
  googlePlaceId,
  redemptionId,
  status,
  noteId,
  isPublic = false,
  redemptionStatus,
  verifiedAt,
}: PassportMemoryCardProps) {
  const canShare = offerPublicToggle({ redemptionStatus, verifiedAt });
  const [shared, setShared] = useState(isPublic);
  const [sharedSource, setSharedSource] = useState(isPublic);
  if (sharedSource !== isPublic) {
    setSharedSource(isPublic);
    setShared(isPublic);
  }
  const stars = rating == null ? null : Math.max(0, Math.min(5, rating));

  return (
    <article className="overflow-hidden rounded-[26px] bg-white shadow-[0_14px_34px_rgba(42,20,66,0.1)]">
      <div className="relative h-[150px] overflow-hidden">
        <div className="absolute inset-0">
          <RestaurantPhoto
            restaurantId={restaurantId}
            imageUrl={imageUrl}
            googlePlaceId={googlePlaceId}
            className="h-[150px] w-full object-cover"
          />
        </div>
        <span className="absolute top-3 left-3 rounded-full bg-[#dcfce7] px-2.5 py-1 text-xs font-bold text-[#14532d]">
          Verified
        </span>
        <span className="absolute right-3 bottom-3 rounded-full border border-dashed border-white/45 bg-black/25 px-2 py-1 text-[10px] font-semibold tracking-wide text-white">
          {photoLabel}
        </span>
      </div>
      <div className="flex flex-col gap-3.5 p-[18px]">
        <div className="flex items-end justify-between gap-2.5">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="font-display m-0 text-[34px] leading-none font-normal text-wb-ink">{name}</h2>
            <span className="text-[13px] text-wb-muted">{meta}</span>
          </div>
          {stars == null ? null : (
            <div role="img" aria-label={`Rated ${stars} out of 5`} className="flex shrink-0 gap-0.5 pb-1 text-[#f59e0b]">
              {Array.from({ length: 5 }, (_, index) => (
                <svg
                  key={index}
                  aria-hidden="true"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill={index < stars ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              ))}
            </div>
          )}
        </div>
        {note ? <p className="font-display m-0 text-[22px] leading-snug text-wb-plum italic">“{note}”</p> : null}
        {noteId && canShare ? (
          <div className="rounded-2xl bg-[#f6f1e8] px-3.5 py-3">
            <NotePrivacyControl noteId={noteId} isPublic={isPublic} onChange={setShared} />
            <p className="m-0 mt-1 text-xs text-wb-muted">
              {shared ? 'Other members can read this memory' : 'Only you can see this memory'}
            </p>
          </div>
        ) : noteId ? (
          <p className="m-0">
            <span
              data-note-visibility={isPublic ? 'public' : 'private'}
              className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium"
            >
              {isPublic ? 'Public' : 'Private'}
            </span>
          </p>
        ) : null}
        <MemoryEntryLink
          status={status}
          redemptionId={redemptionId}
          returnTo={PASSPORT_RETURN}
          className="text-wb-violet"
        />
      </div>
    </article>
  );
}

type QuickMemoryCardProps = {
  restaurantName: string;
  redemptionId: string;
};

export function QuickMemoryCard({ restaurantName, redemptionId }: QuickMemoryCardProps) {
  const href = noteEditorHref(redemptionId, PASSPORT_RETURN);
  return (
    <section aria-labelledby="quick-memory" className="relative flex flex-col gap-3.5 overflow-hidden rounded-[26px] bg-wb-plum p-5 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(251,113,133,0.4) 0%, rgba(251,113,133,0) 70%)' }}
      />
      <div className="relative flex items-center gap-2.5">
        <Bea state="idle" size={28} />
        <span className="text-[13px] text-wb-lavender-2">Bea asks</span>
      </div>
      <h2 id="quick-memory" className="font-display relative m-0 text-[28px] leading-tight font-normal text-white">
        How was {restaurantName}? <em className="text-wb-blush">One tap is enough.</em>
      </h2>
      <div className="relative flex gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <a
            key={star}
            href={href}
            aria-label={`${star} ${star === 1 ? 'star' : 'stars'}. Add a memory for ${restaurantName}. The note is private by default.`}
            className="inline-flex size-12 items-center justify-center rounded-full border border-white/20 bg-white/5 text-[#fde68a]"
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </a>
        ))}
      </div>
      <p className="relative m-0 text-xs text-white/70">The note is private by default.</p>
      <div className="relative">
        <MemoryEntryLink
          status="verified"
          redemptionId={redemptionId}
          returnTo={PASSPORT_RETURN}
          className="text-wb-blush"
        />
      </div>
    </section>
  );
}
