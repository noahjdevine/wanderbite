'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DiscoverAsk } from '@/components/discover/discover-ask';
import { DiscoverPick } from '@/components/discover/discover-pick';
import { DiscoverThinking } from '@/components/discover/discover-thinking';
import { useDiscoverAutoStart } from '@/components/discover/use-discover-auto-start';
import { RecipeQaAnswer, type RecipeQaAnswerView } from '@/components/recipes/recipe-qa-answer';
import { postDiscoverAsk } from '@/lib/discover/client';
import type { DiscoverEvent } from '@/lib/discover/events';
import {
  DISCOVER_ALLERGY_NOTICE,
  DISCOVER_MESSAGE_TOO_LONG,
  DISCOVER_NETWORK_ERROR,
  DISCOVER_QUICK_CHIPS,
  DISCOVER_STREAM_BROKE,
  EMPTY_DISCOVER_DRAFT,
  applyQuickChip,
  dietaryButtonLabel,
  dietaryFlagsForStatus,
  draftToSpinBody,
  foodForOutcome,
  outcomeFromEvents,
  refineDiscoverDraft,
  scheduleDiscoverReveal,
  thinkingSteps,
  type DiscoverDraft,
  type DiscoverRefine,
  type DiscoverViewer,
} from '@/lib/discover/screen';
import { cuisineLabel } from '@/lib/cuisines';
import {
  getExcludedCuisinesServerSnapshot,
  getExcludedCuisinesSnapshot,
  subscribeExcludedCuisines,
} from '@/lib/excluded-cuisines-store';
import { ROULETTE_MAX_MESSAGE_CHARS } from '@/lib/ai-bounds';
import type { RouletteSelections } from '@/components/roulette/roulette-options-fields';

type Phase = 'ask' | 'thinking' | 'pick' | 'error' | 'recipe';

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function DiscoverFlow({
  initialMessage,
  autoStartToken = null,
  viewer,
}: {
  initialMessage: string;
  /** Homepage submit id. Absent for a typed visit, a refresh, or a shared link. */
  autoStartToken?: string | null;
  viewer: DiscoverViewer;
}) {
  const excludedCuisines = useSyncExternalStore(
    subscribeExcludedCuisines,
    getExcludedCuisinesSnapshot,
    getExcludedCuisinesServerSnapshot,
  );
  const [draft, setDraft] = useState<DiscoverDraft>({
    ...EMPTY_DISCOVER_DRAFT,
    message: initialMessage,
  });
  const [refineOpen, setRefineOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('ask');
  const [events, setEvents] = useState<DiscoverEvent[]>([]);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [outcomeReady, setOutcomeReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recipeQa, setRecipeQa] = useState<RecipeQaAnswerView | null>(null);
  const [originDraft, setOriginDraft] = useState<DiscoverDraft | null>(null);

  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const cancelReveal = useRef<(() => void) | null>(null);
  const inFlight = useRef(false);

  const exclusionsSummary = useMemo(() => {
    if (excludedCuisines.length === 0) return null;
    const first = excludedCuisines.slice(0, 3).map(cuisineLabel);
    const more = excludedCuisines.length - first.length;
    return more > 0 ? `${first.join(', ')} +${more} more` : first.join(', ');
  }, [excludedCuisines]);

  const dietaryLabel = dietaryButtonLabel(
    dietaryFlagsForStatus(viewer.savedDietary, draft.dietaryFlags),
  );

  const run = useCallback(
    async (
      next: DiscoverDraft,
      replaceOrigin: boolean,
      excludeRestaurantIds?: readonly string[],
    ) => {
      if (inFlight.current) return;
      const withExclusions: DiscoverDraft = {
        ...next,
        excludedCuisines: [...excludedCuisines],
      };
      if (
        !withExclusions.surprise &&
        withExclusions.message.length > ROULETTE_MAX_MESSAGE_CHARS
      ) {
        setDraft(withExclusions);
        setErrorMessage(DISCOVER_MESSAGE_TOO_LONG);
        setPhase('error');
        return;
      }

      inFlight.current = true;
      const id = requestId.current + 1;
      requestId.current = id;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      cancelReveal.current?.();
      if (replaceOrigin) setOriginDraft(withExclusions);
      setDraft(withExclusions);
      setEvents([]);
      setVisibleSteps(0);
      setOutcomeReady(false);
      setErrorMessage(null);
      setRecipeQa(null);
      setPhase('thinking');

      try {
        const spin = draftToSpinBody(withExclusions);
        const body =
          excludeRestaurantIds && excludeRestaurantIds.length > 0
            ? { ...spin, excludeRestaurantIds: [...excludeRestaurantIds] }
            : spin;
        const result = await postDiscoverAsk(body, crypto.randomUUID(), controller.signal);
        if (requestId.current !== id) return;
        if (result.kind === 'error') {
          setErrorMessage(result.message);
          setPhase('error');
          return;
        }
        if (result.kind === 'recipe') {
          setRecipeQa(result.qa);
          setPhase('recipe');
          return;
        }
        setEvents(result.events);
      } catch {
        if (controller.signal.aborted || requestId.current !== id) return;
        setErrorMessage(DISCOVER_NETWORK_ERROR);
        setPhase('error');
      } finally {
        if (requestId.current === id) inFlight.current = false;
      }
    },
    [excludedCuisines],
  );

  useDiscoverAutoStart({
    token: autoStartToken,
    initialMessage,
    currentMessage: draft.message,
    onStart: () => {
      void run(draft, true);
    },
  });

  useEffect(() => {
    if (phase !== 'thinking' || events.length === 0) return;
    const reduced = prefersReducedMotion();
    const cancel = scheduleDiscoverReveal({
      stepCount: thinkingSteps(events).length,
      reducedMotion: reduced,
      onVisibleSteps: setVisibleSteps,
      onOutcome: () => setOutcomeReady(true),
    });
    cancelReveal.current = cancel;
    return () => {
      cancel();
      if (cancelReveal.current === cancel) cancelReveal.current = null;
    };
  }, [phase, events]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      cancelReveal.current?.();
    };
  }, []);

  function backToAsk() {
    abortRef.current?.abort();
    requestId.current += 1;
    inFlight.current = false;
    cancelReveal.current?.();
    setPhase('ask');
    setOutcomeReady(false);
    setErrorMessage(null);
  }

  function resubmit(refine: DiscoverRefine, excludeRestaurantId?: string) {
    const origin = originDraft ?? draft;
    const excludeRestaurantIds =
      refine === 'another' && excludeRestaurantId ? [excludeRestaurantId] : undefined;
    void run(refineDiscoverDraft(origin, refine), false, excludeRestaurantIds);
  }

  const outcome = outcomeFromEvents(events);
  const steps = thinkingSteps(events);
  const revealDone = phase === 'thinking' && outcomeReady && events.length > 0;
  const showPick = revealDone && (outcome.kind === 'pick' || outcome.kind === 'fallback');
  const showStreamError = revealDone && !showPick;
  const streamError =
    outcome.kind === 'error' ? outcome.message : DISCOVER_STREAM_BROKE;
  const quote = (originDraft ?? draft).message;

  return (
    <>
      {phase === 'ask' ? (
        <DiscoverAsk
          draft={draft}
          greetingName={viewer.firstName}
          dietaryLabelFlags={dietaryFlagsForStatus(viewer.savedDietary, draft.dietaryFlags)}
          refineOpen={refineOpen}
          exclusionsSummary={exclusionsSummary}
          onMessage={(message) => setDraft((prev) => ({ ...prev, message, surprise: false }))}
          onSelections={(patch: Partial<RouletteSelections>) =>
            setDraft((prev) => ({ ...prev, ...patch, surprise: false }))
          }
          onToggleRefine={() => setRefineOpen((open) => !open)}
          onQuickChip={(index) => {
            const chip = DISCOVER_QUICK_CHIPS[index];
            if (!chip) return;
            void run(applyQuickChip(draft, chip), true);
          }}
          onSubmit={() => void run(draft, true)}
        />
      ) : null}

      {phase === 'thinking' && !showPick && !showStreamError ? (
        <DiscoverThinking
          quote={quote}
          steps={steps}
          visibleCount={visibleSteps}
          outcome={outcome}
          food={foodForOutcome(outcome)}
          showFoundLine={
            outcome.kind === 'pick' && steps.length > 0 && visibleSteps >= steps.length && !outcomeReady
          }
          onBack={backToAsk}
          onSkip={() => {
            cancelReveal.current?.();
            cancelReveal.current = null;
            setVisibleSteps(steps.length);
            setOutcomeReady(true);
          }}
        />
      ) : null}

      {showPick && (outcome.kind === 'pick' || outcome.kind === 'fallback') ? (
        <DiscoverPick
          outcome={outcome}
          food={foodForOutcome(outcome)}
          dietaryLabel={dietaryLabel}
          steps={prefersReducedMotion() ? steps : []}
          onDietary={() => {
            setRefineOpen(true);
            backToAsk();
          }}
          onAnother={() => {
            const shownId =
              outcome.kind === 'fallback' ? outcome.event.alternative.id : outcome.event.partner.id;
            resubmit('another', shownId);
          }}
          onCheaper={() => resubmit('cheaper')}
          onNewVibe={() => resubmit('new-vibe')}
        />
      ) : null}

      {phase === 'recipe' && recipeQa ? (
        <div data-screen="recipe" className="mx-auto w-full max-w-lg px-4 py-8">
          <p className="mb-4 text-center text-sm text-white/75">{DISCOVER_ALLERGY_NOTICE}</p>
          <div className="rounded-[24px] bg-wb-cream p-5 text-wb-ink">
            <h1 className="font-display text-3xl">Recipe and visit notes</h1>
            <div className="mt-4">
              <RecipeQaAnswer qa={recipeQa} />
            </div>
          </div>
          <div className="mt-6 flex justify-center">
            <button type="button" className="wb-cta-secondary wb-cta-secondary-dark" onClick={backToAsk}>
              Back to Ask
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'error' || showStreamError ? (
        <div data-screen="error" className="mx-auto flex min-h-[50vh] w-full max-w-lg flex-col items-center justify-center gap-6 px-4 text-center">
          <p className="text-lg text-white">{phase === 'error' ? (errorMessage ?? DISCOVER_STREAM_BROKE) : streamError}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className="wb-cta" onClick={backToAsk}>
              Back to Ask
            </button>
            <button
              type="button"
              className="wb-cta-secondary wb-cta-secondary-dark"
              onClick={() => void run(originDraft ?? draft, false)}
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
