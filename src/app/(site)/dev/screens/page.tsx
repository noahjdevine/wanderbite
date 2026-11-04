import { notFound } from 'next/navigation';
import { isComponentGalleryEnabled } from '@/lib/dev/component-gallery';
import { ScreenPreview } from './screen-preview';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Screens',
  robots: { index: false, follow: false },
};

export default async function DevScreensPage({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string }>;
}) {
  if (!isComponentGalleryEnabled()) notFound();
  const params = await searchParams;
  const screen = params.screen === 'redeem' ? 'redeem' : 'challenges';
  return <ScreenPreview screen={screen} />;
}
