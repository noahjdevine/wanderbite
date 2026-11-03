'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DiscoveryVoiceControls } from '@/components/roulette/discovery-voice-controls';
import { revealMonthlyChallenge } from '@/app/actions/reveal-challenge';
import {
  appendRevealTranscript,
  DISCOVERY_CHIPS,
  MONTHLY_REVEAL_FOCUS_KEY,
  OCCASION_CHIPS,
  REVEAL_SUMMARY_CAP,
  revealMemberMessage,
} from '@/lib/challenges/monthly-reveal-copy';

type MonthlyCurationProps = {
  constraintLines: string[];
};

function rememberRevealFocus(): void {
  try {
    sessionStorage.setItem(MONTHLY_REVEAL_FOCUS_KEY, '1');
  } catch {
    // Private browsing can reject storage. The pair still renders after refresh.
  }
}

export function MonthlyCuration({ constraintLines }: MonthlyCurationProps) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [occasion, setOccasion] = useState<string | null>(null);
  const [discoveryLevel, setDiscoveryLevel] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function reveal(surpriseMe: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await revealMonthlyChallenge({
        occasion: surpriseMe ? null : occasion,
        discoveryLevel: surpriseMe ? null : discoveryLevel,
        summary: surpriseMe ? '' : summary,
        surpriseMe,
      });
      if (result.ok) {
        rememberRevealFocus();
        router.refresh();
        return;
      }
      setMessage(revealMemberMessage(result));
      inFlight.current = false;
      setBusy(false);
    } catch {
      setMessage(revealMemberMessage({ error: '', reason: 'retryable' }));
      inFlight.current = false;
      setBusy(false);
    }
  }

  function toggle(current: string | null, value: string, set: (next: string | null) => void) {
    if (busy) return;
    set(current === value ? null : value);
  }

  return (
    <section className="space-y-5 rounded-xl border border-border bg-card p-4 sm:p-6" aria-labelledby="monthly-curation-heading">
      <div className="space-y-2">
        <h2 id="monthly-curation-heading" className="text-lg font-semibold">
          Choose this month’s challenges
        </h2>
        <p className="text-sm text-muted-foreground">
          Answer up to two questions, or describe the month in your own words. Then reveal once.
          A note such as a restaurant name is saved with the reveal and does not assign that restaurant.
        </p>
      </div>

      <ul className="space-y-1 text-sm text-muted-foreground">
        {constraintLines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-sm font-medium text-foreground">Occasion or mood</legend>
        <div className="flex flex-wrap gap-2">
          {OCCASION_CHIPS.map((chip) => (
            <Button
              key={chip}
              type="button"
              size="sm"
              variant={occasion === chip ? 'default' : 'outline'}
              aria-pressed={occasion === chip}
              onClick={() => toggle(occasion, chip, setOccasion)}
            >
              {chip}
            </Button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-sm font-medium text-foreground">Discovery level</legend>
        <div className="flex flex-wrap gap-2">
          {DISCOVERY_CHIPS.map((chip) => (
            <Button
              key={chip}
              type="button"
              size="sm"
              variant={discoveryLevel === chip ? 'default' : 'outline'}
              aria-pressed={discoveryLevel === chip}
              onClick={() => toggle(discoveryLevel, chip, setDiscoveryLevel)}
            >
              {chip}
            </Button>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <label htmlFor="monthly-reveal-summary" className="text-sm font-medium text-foreground">
          Anything else? (optional)
        </label>
        <textarea
          id="monthly-reveal-summary"
          value={summary}
          maxLength={REVEAL_SUMMARY_CAP}
          rows={3}
          disabled={busy}
          onChange={(event) => setSummary(event.target.value.slice(0, REVEAL_SUMMARY_CAP))}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm"
          placeholder="Weeknight, not too far, something I have not tried"
        />
        <p className="text-right text-xs text-muted-foreground">
          {summary.length}/{REVEAL_SUMMARY_CAP}
        </p>
        <DiscoveryVoiceControls
          disabled={busy}
          context="monthly"
          transcriptFieldId="monthly-reveal-summary"
          onTranscript={(transcript) => setSummary((current) => appendRevealTranscript(current, transcript))}
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={() => void reveal(true)}>
          Surprise me
        </Button>
        <Button type="button" className="w-full sm:w-auto" disabled={busy} onClick={() => void reveal(false)}>
          {busy ? 'Revealing…' : 'Reveal my challenges'}
        </Button>
      </div>

      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {message ?? (busy ? 'Revealing your challenges.' : '')}
      </p>
    </section>
  );
}
