'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  PASSPORT_SHARE_FILENAME,
  PASSPORT_SHARE_IMAGE_PATH,
} from '@/lib/passport/share-card';
import {
  buildPassportShare,
  type PassportSharePayload,
  type PassportShareSource,
} from '@/lib/passport/passport-board';
import { shareOrCopy } from '@/lib/share';

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export async function fetchPassportShareFile(signal: AbortSignal): Promise<File> {
  const response = await fetch(PASSPORT_SHARE_IMAGE_PATH, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) throw new Error('passport share image failed');
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('image/png')) throw new Error('passport share image failed');
  const blob = await response.blob();
  if (blob.size === 0) throw new Error('passport share image failed');
  return new File([blob], PASSPORT_SHARE_FILENAME, { type: 'image/png' });
}

export function canSharePassportFile(file: File): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

type Phase = 'closed' | 'loading' | 'ready';

export function usePassportSharePreview(source: PassportShareSource) {
  const [phase, setPhase] = useState<Phase>('closed');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const fileRef = useRef<File | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { progressUnavailable, uniqueRestaurants, neighborhoods, currentStreak } = source;
  const payload = useCallback((): PassportSharePayload => {
    return buildPassportShare({
      progressUnavailable,
      uniqueRestaurants,
      neighborhoods,
      currentStreak,
    });
  }, [currentStreak, neighborhoods, progressUnavailable, uniqueRestaurants]);

  const replaceUrl = useCallback((next: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = next;
    setImageUrl(next);
  }, []);

  const closePreview = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    fileRef.current = null;
    replaceUrl(null);
    setPhase('closed');
  }, [replaceUrl]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const fallbackTextShare = useCallback(async () => {
    const outcome = await shareOrCopy(payload());
    if (outcome === 'copied') toast.success('Link copied to clipboard!');
    else if (outcome === 'error') toast.error('Could not share. Try copying the link manually.');
  }, [payload]);

  const openPreview = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    fileRef.current = null;
    replaceUrl(null);
    setReducedMotion(prefersReducedMotion());
    setPhase('loading');
    try {
      const file = await fetchPassportShareFile(controller.signal);
      if (controller.signal.aborted) return;
      fileRef.current = file;
      replaceUrl(URL.createObjectURL(file));
      setPhase('ready');
    } catch {
      if (controller.signal.aborted) return;
      fileRef.current = null;
      replaceUrl(null);
      setPhase('closed');
      await fallbackTextShare();
    }
  }, [fallbackTextShare, replaceUrl]);

  const sharePreview = useCallback(async () => {
    const file = fileRef.current;
    const data = payload();
    if (!file) {
      await fallbackTextShare();
      return;
    }
    if (!canSharePassportFile(file)) {
      await fallbackTextShare();
      return;
    }
    try {
      await navigator.share({
        files: [file],
        title: data.title,
        text: data.text,
        url: data.url,
      });
      closePreview();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast.error('Could not share. Try saving the image instead.');
    }
  }, [closePreview, fallbackTextShare, payload]);

  return {
    phase,
    imageUrl,
    reducedMotion,
    openPreview,
    closePreview,
    sharePreview,
  };
}

type PassportShareSheetProps = {
  phase: Phase;
  imageUrl: string | null;
  reducedMotion: boolean;
  onCancel: () => void;
  onShare: () => void;
};

export function PassportShareSheet({
  phase,
  imageUrl,
  reducedMotion,
  onCancel,
  onShare,
}: PassportShareSheetProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase === 'closed') return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, phase]);

  if (phase === 'closed') return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {reducedMotion ? null : (
        <style>
          {`@keyframes wb-share-preview-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`}
        </style>
      )}
      <div className="absolute inset-0 bg-[#120a24]/70" aria-hidden onClick={onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={phase === 'loading'}
        tabIndex={-1}
        data-reduced-motion={reducedMotion ? 'true' : 'false'}
        className="relative z-10 flex max-h-[100dvh] w-full max-w-md flex-col gap-4 overflow-y-auto bg-[#faf6ef] px-5 pt-5 pb-6 text-[#1f1530] outline-none sm:rounded-3xl"
        style={
          reducedMotion ? undefined : { animation: 'wb-share-preview-in 180ms ease-out' }
        }
      >
        <h2 id={titleId} className="font-display m-0 text-[32px] leading-none">
          Share your passport
        </h2>
        {phase === 'loading' ? (
          <p className="m-0 text-sm text-[#6b6275]">Preparing your passport</p>
        ) : null}
        {phase === 'ready' && imageUrl ? (
          // Blob preview of this member's own card. next/image does not load blob: URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Wanderbite passport preview"
            className="mx-auto h-auto w-full max-w-[280px] rounded-2xl border border-[#e6dccb]"
          />
        ) : null}
        <div className="flex flex-col gap-2">
          {phase === 'ready' ? (
            <button
              type="button"
              onClick={onShare}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#2a1442] px-4 text-sm font-semibold text-white"
            >
              Share
            </button>
          ) : null}
          {phase === 'ready' && imageUrl ? (
            <a
              href={imageUrl}
              download={PASSPORT_SHARE_FILENAME}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#2a1442] px-4 text-sm font-semibold text-[#2a1442] no-underline"
            >
              Save image
            </a>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold text-[#1f1530]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
