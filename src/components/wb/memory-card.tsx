"use client";

import { useState } from "react";

type MemoryCardProps = {
  name: string;
  meta: string;
  note: string;
  rating: number;
  photoLabel: string;
  editHref: string;
  addPhotoHref: string;
  initialVisibility?: "private" | "public";
};

export function MemoryCard({
  name,
  meta,
  note,
  rating,
  photoLabel,
  editHref,
  addPhotoHref,
  initialVisibility = "private",
}: MemoryCardProps) {
  const [visibility, setVisibility] = useState(initialVisibility);
  const shared = visibility === "public";
  const stars = Math.max(0, Math.min(5, rating));

  return (
    <article className="overflow-hidden rounded-[26px] bg-white shadow-[0_14px_34px_rgba(42,20,66,0.1)]" aria-label={name}>
      <div className="relative h-[150px] overflow-hidden">
        <div
          aria-hidden="true"
          className="wb-drift absolute inset-[-6%]"
          style={{
            background:
              "radial-gradient(circle at 30% 45%, rgba(253,224,171,0.8) 0%, rgba(253,224,171,0) 36%), linear-gradient(155deg, #3f3a1f 0%, #2a1442 70%, #120a24 100%)",
          }}
        />
        <span className="absolute top-3 left-3 rounded-full bg-wb-ok-bg px-2.5 py-1 text-xs font-bold text-wb-ok-fg">Verified</span>
        <span className="absolute right-3 bottom-3 rounded-full border border-dashed border-white/45 px-2 py-1 text-[10px] font-semibold tracking-wide text-white/85">
          {photoLabel}
        </span>
      </div>
      <div className="flex flex-col gap-3.5 p-[18px]">
        <div className="flex items-end justify-between gap-2.5">
          <div className="flex flex-col gap-1">
            <h3 className="font-display m-0 text-[34px] leading-none font-normal text-wb-ink">{name}</h3>
            <span className="text-[13px] text-wb-muted">{meta}</span>
          </div>
          <div role="img" aria-label={`Rated ${stars} out of 5`} className="flex gap-0.5 pb-1 text-[#f59e0b]">
            {Array.from({ length: 5 }, (_, index) => (
              <svg key={index} aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill={index < stars ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            ))}
          </div>
        </div>
        <p className="font-display m-0 text-[22px] leading-snug text-wb-plum italic">“{note}”</p>
        <div className="flex items-center gap-3 rounded-2xl bg-[#f6f1e8] px-3.5 py-3">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5a4f6a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {shared ? (
              <>
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 7.5-2" />
              </>
            ) : (
              <>
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </>
            )}
          </svg>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-semibold text-wb-ink">{shared ? "Public" : "Private"}</span>
            <span className="text-xs text-wb-muted">
              {shared ? "Visible on your shared Passport" : "Only you can see this memory"}
            </span>
          </div>
          <button
            type="button"
            aria-pressed={shared}
            aria-label={shared ? "Make this memory private" : "Share as a public review"}
            onClick={() => setVisibility(shared ? "private" : "public")}
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-2 text-xs font-semibold text-wb-ink"
          >
            Share
            <span className="relative h-[26px] w-11 rounded-full" style={{ background: shared ? "var(--wb-violet)" : "#d9d0c2" }}>
              <span
                aria-hidden="true"
                className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow"
                style={{ left: shared ? 21 : 3 }}
              />
            </span>
          </button>
        </div>
        <div className="flex gap-4 text-sm font-semibold">
          <a href={editHref} className="text-wb-violet">
            Edit memory
          </a>
          <a href={addPhotoHref} className="text-wb-violet">
            Add photo
          </a>
        </div>
      </div>
    </article>
  );
}
