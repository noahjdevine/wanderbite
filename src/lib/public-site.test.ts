import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_SITE_ORIGIN, publicShareUrl } from '@/lib/public-site';
import { shareOrCopy } from '@/lib/share';

describe('public share origin', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('builds wanderbite.co links and ignores the site env', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://wanderbite.com');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://preview.example');
    expect(PUBLIC_SITE_ORIGIN).toBe('https://wanderbite.co');
    expect(publicShareUrl()).toBe('https://wanderbite.co');
    expect(publicShareUrl('/')).toBe('https://wanderbite.co');
    expect(publicShareUrl('/journey')).toBe('https://wanderbite.co/journey');
    expect(publicShareUrl('passport')).toBe('https://wanderbite.co/passport');
  });

  it('uses that origin when shareOrCopy is called without a url', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', {
      clipboard: { writeText },
    });
    await expect(shareOrCopy({ title: 'Passport', text: 'My passport' })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('My passport https://wanderbite.co');
  });
});
