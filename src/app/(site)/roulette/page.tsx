import { RouletteClient } from '@/components/roulette/roulette-client';
import { parseDiscoverQuery } from '@/lib/home/hero';

export const metadata = {
  title: 'Discover',
  description:
    'Ask for a restaurant in McKinney, Texas. Discovery cannot assess allergies. No login required.',
};

type RoulettePageProps = {
  searchParams: Promise<{ q?: string | string[] }>;
};

export default async function RoulettePage({ searchParams }: RoulettePageProps) {
  const params = await searchParams;
  const initialMessage = parseDiscoverQuery(params.q);
  return (
    <main className="min-h-screen bg-gradient-to-b from-orange-50/80 to-background">
      <RouletteClient key={initialMessage} initialMessage={initialMessage} />
    </main>
  );
}
