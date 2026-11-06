import { notFound } from 'next/navigation';
import { isComponentGalleryEnabled } from '@/lib/dev/component-gallery';
import { JournalPreview, MapPreview, PassportPreview } from './passport-preview';
import { ProgressPreview } from './progress-preview';
import { RestaurantsPreview } from './restaurants-preview';
import { ScreenPreview } from './screen-preview';
import { StampUnlockPreview } from './stamp-unlock-preview';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Screens',
  robots: { index: false, follow: false },
};

export default async function DevScreensPage({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string; state?: string }>;
}) {
  if (!isComponentGalleryEnabled()) notFound();
  const params = await searchParams;
  if (params.screen === 'progress') return <ProgressPreview />;
  if (params.screen === 'passport') return <PassportPreview />;
  if (params.screen === 'journal' || params.screen === 'timeline') return <JournalPreview />;
  if (params.screen === 'map') return <MapPreview />;
  if (params.screen === 'stamp-unlock') return <StampUnlockPreview />;
  if (params.screen === 'restaurants') {
    const state = params.state === 'empty' || params.state === 'error' ? params.state : 'ready';
    return <RestaurantsPreview state={state} />;
  }
  const screen = params.screen === 'redeem' ? 'redeem' : 'challenges';
  return <ScreenPreview screen={screen} />;
}
