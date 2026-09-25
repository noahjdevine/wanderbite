import { RouletteClient } from '@/components/roulette/roulette-client';

export const metadata = {
  title: 'Discover',
  description:
    'Ask for a restaurant in McKinney, Texas. Discovery cannot assess allergies. No login required.',
};

export default function RoulettePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-orange-50/80 to-background">
      <RouletteClient />
    </main>
  );
}
