'use client';

import { useState } from 'react';
import { Stamp } from '@/components/wb';
import { cuisineInk, stampRotationDegrees } from '@/lib/passport/passport-board';

const SAMPLE_ID = '22222222-2222-4222-8222-222222222222';

/** Gallery replay. It does not read or write the member's seen-stamp storage. */
export function StampUnlockPreview() {
  const [replay, setReplay] = useState(0);
  const ink = cuisineInk(['American']);
  const rotation = stampRotationDegrees(SAMPLE_ID);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-center justify-center gap-8 bg-wb-cream px-5 py-16">
      <div className="text-center">
        <p className="text-sm font-semibold tracking-wide text-wb-muted uppercase">Stamp unlock</p>
        <h1 className="font-display mt-2 text-[40px] leading-none text-wb-ink">The Yard</h1>
      </div>
      <Stamp
        key={replay}
        name="The Yard"
        date="Apr 26"
        accessibleDate="April 26, 2026"
        neighborhood="Downtown"
        inkColor={ink.color}
        shape="rect"
        rotation={rotation}
        playSlam
        onSelect={() => {}}
      />
      <p className="sr-only" aria-live="polite">
        New stamp: The Yard
      </p>
      <button
        type="button"
        className="min-h-11 rounded-full bg-wb-plum px-5 text-sm font-semibold text-white"
        onClick={() => setReplay((count) => count + 1)}
      >
        Replay stamp
      </button>
    </main>
  );
}
