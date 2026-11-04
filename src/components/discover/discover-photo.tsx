'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { decodeEntities } from '@/lib/format/text';
import { isSafePhotoCredit, type PhotoCredit } from '@/lib/google-photo-credit';
import { RESTAURANT_IMAGE_PLACEHOLDER } from '@/lib/restaurant-image';

type DiscoverPhotoProps = {
  photoUrl?: string | null;
  photoCredit?: string | null;
  name: string;
  priority?: boolean;
  decorative?: boolean;
};

type Shown =
  | { kind: 'static'; src: string }
  | { kind: 'photo'; src: string; credit: PhotoCredit[] | null }
  | { kind: 'placeholder' };

function proxyRestaurantId(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  const match = /^\/api\/restaurant-image\/([^/?#]+)$/.exec(photoUrl);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function staticPhoto(photoUrl: string | null | undefined): string | null {
  if (!photoUrl || !photoUrl.startsWith('/images/')) return null;
  if (photoUrl === RESTAURANT_IMAGE_PLACEHOLDER) return null;
  return photoUrl;
}

export function DiscoverPhoto({
  photoUrl,
  photoCredit,
  name,
  priority = false,
  decorative = false,
}: DiscoverPhotoProps) {
  const manual = staticPhoto(photoUrl);
  const proxyId = proxyRestaurantId(photoUrl);
  const [shown, setShown] = useState<Shown>(
    manual ? { kind: 'static', src: manual } : { kind: 'placeholder' },
  );

  useEffect(() => {
    if (manual || !proxyId) return;
    const holder: { url: string | null } = { url: null };
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`/api/restaurant-image/${proxyId}`, { cache: 'no-store' });
        const data = (await res.json()) as {
          ok?: boolean;
          contentType?: string;
          imageBase64?: string;
          credit?: unknown;
        };
        if (cancelled || !data.ok || typeof data.imageBase64 !== 'string') return;
        const contentType = data.contentType ?? '';
        if (
          contentType !== 'image/jpeg' &&
          contentType !== 'image/png' &&
          contentType !== 'image/webp'
        ) {
          return;
        }
        let credit: PhotoCredit[] | null = null;
        if (data.credit != null) {
          if (!Array.isArray(data.credit) || !data.credit.every(isSafePhotoCredit)) return;
          credit = data.credit;
        }
        const binary = Uint8Array.from(atob(data.imageBase64), (char) => char.charCodeAt(0));
        const blob = new Blob([binary], { type: contentType });
        holder.url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(holder.url);
          holder.url = null;
          return;
        }
        setShown({ kind: 'photo', src: holder.url, credit });
      } catch {
        if (!cancelled) setShown({ kind: 'placeholder' });
      }
    })();

    return () => {
      cancelled = true;
      if (holder.url) URL.revokeObjectURL(holder.url);
    };
  }, [manual, proxyId]);

  const src =
    shown.kind === 'static' ? shown.src : shown.kind === 'photo' ? shown.src : RESTAURANT_IMAGE_PLACEHOLDER;
  const eventCredit = photoCredit?.trim() ? decodeEntities(photoCredit.trim()) : null;
  const fetched = shown.kind === 'photo' ? shown.credit : null;
  const alt = decorative || shown.kind === 'placeholder' ? '' : name;

  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden bg-wb-night-2">
      <div className="wb-drift absolute inset-[-4%]">
        <Image
          src={src}
          alt={alt}
          fill
          priority={priority}
          unoptimized={shown.kind === 'photo'}
          sizes="(min-width: 1024px) 640px, 100vw"
          className="object-cover"
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/55 to-transparent" />
      {fetched && fetched.length > 0 ? (
        <p className="absolute inset-x-3 bottom-14 truncate text-[11px] text-white/85">
          {fetched.map((credit) => (
            <a
              key={credit.href}
              href={credit.href}
              target="_blank"
              rel="noopener noreferrer"
              className="pointer-events-auto underline-offset-2 hover:underline"
            >
              {decodeEntities(credit.name)}
            </a>
          ))}
        </p>
      ) : eventCredit ? (
        <p className="absolute bottom-14 left-3 text-[11px] text-white/85">{eventCredit}</p>
      ) : shown.kind === 'placeholder' ? (
        <p className="absolute bottom-14 left-3 text-[11px] text-white/85">Placeholder photo</p>
      ) : null}
    </div>
  );
}
