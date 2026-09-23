'use client';

import { useEffect, useState } from 'react';
import {
  isSafePhotoCredit,
  type PhotoCredit,
} from '@/lib/google-photo-credit';
import {
  RESTAURANT_IMAGE_PLACEHOLDER,
  safeManualImagePath,
} from '@/lib/restaurant-image';

type RestaurantPhotoProps = {
  restaurantId: string;
  imageUrl?: string | null;
  googlePlaceId?: string | null;
  className?: string;
};

type Shown =
  | { kind: 'static'; src: string }
  | { kind: 'photo'; src: string; credit: PhotoCredit[] | null }
  | { kind: 'placeholder' };

function StaticImage({ src, className }: { src: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={800}
      height={600}
      className={className ?? 'h-full w-full object-cover'}
    />
  );
}

export function RestaurantPhoto({
  restaurantId,
  imageUrl,
  googlePlaceId,
  className,
}: RestaurantPhotoProps) {
  const manual = safeManualImagePath(imageUrl);
  const [shown, setShown] = useState<Shown>(
    manual
      ? { kind: 'static', src: manual }
      : googlePlaceId?.trim()
        ? { kind: 'placeholder' }
        : { kind: 'placeholder' },
  );

  useEffect(() => {
    if (manual || !googlePlaceId?.trim() || !restaurantId) return;
    const holder: { url: string | null } = { url: null };
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`/api/restaurant-image/${restaurantId}`, {
          cache: 'no-store',
        });
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
  }, [manual, googlePlaceId, restaurantId]);

  if (shown.kind === 'static') {
    return <StaticImage src={shown.src} className={className} />;
  }

  return (
    <div className="relative h-full w-full">
      <StaticImage
        src={shown.kind === 'photo' ? shown.src : RESTAURANT_IMAGE_PLACEHOLDER}
        className={className}
      />
      {shown.kind === 'photo' && shown.credit && shown.credit.length > 0 ? (
        <p className="absolute inset-x-1 bottom-1 truncate rounded bg-black/70 px-1.5 py-0.5 text-[10px] leading-tight text-white">
          {shown.credit.map((credit) => (
            <a
              key={credit.href}
              href={credit.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {credit.name}
            </a>
          ))}
        </p>
      ) : null}
    </div>
  );
}
