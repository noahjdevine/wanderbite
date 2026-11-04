import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassportChrome } from '@/components/passport/passport-chrome';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngResponse() {
  return new Response(PNG, {
    status: 200,
    headers: { 'Content-Type': 'image/png' },
  });
}

function renderChrome() {
  return render(
    <PassportChrome
      displayName="Noah"
      segment="stamps"
      progressUnavailable={false}
      verifiedVisits={1}
      uniqueRestaurants={1}
      neighborhoods={1}
      currentStreak={1}
      longestStreak={1}
      pendingVisits={0}
      earnedBadges={[]}
      showFirstBiteLocked={false}
    >
      <p>Passport body</p>
    </PassportChrome>,
  );
}

const sharePayload = {
  title: 'My Wanderbite Food Passport',
  text: "I've explored 1 restaurant across 1 neighborhood with Wanderbite 🍽️🔥 1 month streak and counting.",
  url: 'https://wanderbite.co',
};

describe('Share My Passport preview', () => {
  const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {});
  const canShare = vi.fn((_data?: ShareData) => false);
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    share.mockReset();
    share.mockResolvedValue(undefined);
    canShare.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
    if (typeof URL.createObjectURL !== 'function') {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: () => 'blob:passport-preview',
      });
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
    }
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens a preview and shares nothing until Share', async () => {
    canShare.mockImplementation((data) => Boolean(data?.files?.length));
    fetchMock.mockResolvedValue(pngResponse());
    renderChrome();
    expect(screen.getByText('1 restaurant')).toBeTruthy();
    expect(screen.getByText('1 neighborhood')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Share My Passport' }));
    expect(await screen.findByRole('img', { name: 'Wanderbite passport preview' })).toBeTruthy();
    expect(share).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const payload = share.mock.calls[0][0];
    expect(payload.title).toBe(sharePayload.title);
    expect(payload.text).toBe(sharePayload.text);
    expect(payload.url).toBe(sharePayload.url);
    expect(payload.files).toHaveLength(1);
    expect(payload.files?.[0]?.type).toBe('image/png');
    expect(payload.files?.[0]?.name).toBe('wanderbite-passport.png');
  });

  it('shares text and keeps a save link when file sharing is unavailable', async () => {
    canShare.mockImplementation((data) => !data?.files?.length);
    fetchMock.mockResolvedValue(pngResponse());
    renderChrome();
    fireEvent.click(screen.getByRole('button', { name: 'Share My Passport' }));
    const save = await screen.findByRole('link', { name: 'Save image' });
    expect(save.getAttribute('download')).toBe('wanderbite-passport.png');
    expect(save.getAttribute('href')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const payload = share.mock.calls[0][0];
    expect(payload).toEqual(sharePayload);
    expect(payload.files).toBeUndefined();
    expect(screen.getByRole('link', { name: 'Save image' })).toBeTruthy();
  });

  it('falls back to the text share when the image route fails', async () => {
    canShare.mockImplementation((data) => !data?.files?.length);
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    renderChrome();
    fireEvent.click(screen.getByRole('button', { name: 'Share My Passport' }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0]).toEqual(sharePayload);
    expect(screen.queryByRole('img', { name: 'Wanderbite passport preview' })).toBeNull();
  });

  it('shows a loading state and does not share until the image is ready', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    renderChrome();
    fireEvent.click(screen.getByRole('button', { name: 'Share My Passport' }));
    expect(await screen.findByText('Preparing your passport')).toBeTruthy();
    expect(share).not.toHaveBeenCalled();
    resolveFetch(pngResponse());
    expect(await screen.findByRole('img', { name: 'Wanderbite passport preview' })).toBeTruthy();
    expect(share).not.toHaveBeenCalled();
  });

  it('does not animate the sheet when reduced motion is requested', async () => {
    canShare.mockReturnValue(true);
    fetchMock.mockResolvedValue(pngResponse());
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    renderChrome();
    fireEvent.click(screen.getByRole('button', { name: 'Share My Passport' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('data-reduced-motion')).toBe('true');
    expect(dialog.getAttribute('style') ?? '').not.toContain('animation');
  });
});
