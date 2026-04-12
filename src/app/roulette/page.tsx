import { RouletteClient } from '@/components/roulette/roulette-client';

export const metadata = {
  title: 'Wanderbite Roulette',
  description:
    'Free AI-powered restaurant randomizer for Austin. Spin Wanderbite Roulette — no login required.',
};

export default function RoulettePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-orange-50/80 to-background">
      <RouletteClient />
    </main>
  );
}
