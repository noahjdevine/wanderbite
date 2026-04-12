type ShareOrCopyArgs = {
  title: string;
  text: string;
  url?: string;
};

/**
 * Uses the Web Share API when available and allowed; otherwise copies
 * `text` and `url` to the clipboard. Treats user dismissal of the share sheet
 * as a completed native flow (no clipboard fallback).
 */
export async function shareOrCopy({
  title,
  text,
  url = 'https://wanderbite.com',
}: ShareOrCopyArgs): Promise<'shared' | 'copied' | 'error'> {
  const data: ShareData = { title, text, url };
  try {
    if (
      typeof navigator.share === 'function' &&
      (typeof navigator.canShare !== 'function' || navigator.canShare(data))
    ) {
      await navigator.share(data);
      return 'shared';
    }
    await navigator.clipboard.writeText(`${text} ${url}`.trim());
    return 'copied';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return 'shared';
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`.trim());
      return 'copied';
    } catch {
      return 'error';
    }
  }
}
