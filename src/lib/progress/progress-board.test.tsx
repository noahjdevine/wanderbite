import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProgressUnavailable, ProgressView } from '@/components/journey/progress-view';
import { showsMonthlyCuration } from '@/lib/challenges/monthly-cron-gate';
import { chicagoMonthStart } from '@/lib/cron-period';
import { AREA_HOLD_HEADING } from '@/lib/launch-market';
import { MEMBER_NAV_ITEMS } from '@/lib/nav-items';
import {
  MY_JOURNEY_VIEW_LABELS,
  myJourneyHref,
  parseMyJourneyView,
} from '@/lib/my-journey-views';
import type { MemberBadge, MemberProgress } from '@/lib/progress/get-member-progress';
import { levelFromXp, PROGRESS_UNAVAILABLE_MESSAGE, XP_LEVELS } from '@/lib/progress/rules';
import { previousChicagoMonth } from '@/lib/streaks';
import {
  assembleProgressAdventures,
  buildProgressModel,
  buildStreakMonths,
  challengesCreditHold,
  headerLabelFor,
  nextChicagoMonth,
  noPairCta,
  pendingCreditsHeadFilters,
  selectNextMove,
  type NoPairCta,
  type ProgressAdventure,
} from '@/lib/progress/progress-board';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

const NOW = new Date('2026-11-04T00:00:00.000Z');
const ROOT = path.resolve(__dirname, '../../..');

const GENERATE = noPairCta({
  launchEligible: true,
  creditsWorkflow: false,
  pendingCreditsCount: 0,
  generateBlocked: false,
});

afterEach(() => {
  cleanup();
});

describe('selectNextMove', () => {
  it('points a waiting code at that code before a memory, a ready challenge, or no pair', () => {
    const move = selectNextMove({
      now: NOW,
      hasPair: false,
      xp: 0,
      nextLevelName: 'The Explorer',
      nextLevelXp: 300,
      noPair: GENERATE,
      adventures: [
        adventure({ id: 'ready', visitStatus: 'ready', restaurantName: 'The Common Table', slotNumber: 1 }),
        adventure({
          id: 'memory',
          redemptionId: 'memory',
          visitStatus: 'verified',
          restaurantName: 'The Yard',
          occurredAt: '2026-04-26T18:00:00.000Z',
        }),
        adventure({
          id: 'later-code',
          redemptionId: 'later-code',
          visitStatus: 'code_issued',
          restaurantName: 'Later',
          expiresAt: '2026-11-04T02:00:00.000Z',
        }),
        adventure({
          id: 'sooner-code',
          redemptionId: 'sooner-code',
          visitStatus: 'code_issued',
          restaurantName: 'Zen Sushi & Grill',
          expiresAt: '2026-11-04T01:00:00.000Z',
        }),
      ],
    });

    expect(move.kind).toBe('code_issued');
    expect(move.actionHref).toBe('/challenges/show/sooner-code');
    expect(move.actionLabel).toBe('Show code');
    expect(move.sentence).toContain('Zen Sushi & Grill');
  });

  it('asks for a new code when the issued code has expired and nothing is still issued', () => {
    const move = selectNextMove({
      now: NOW,
      hasPair: true,
      xp: 0,
      nextLevelName: null,
      nextLevelXp: null,
      noPair: GENERATE,
      adventures: [
        adventure({
          id: 'expired',
          redemptionId: 'expired',
          visitStatus: 'code_expired',
          restaurantName: 'Zen Sushi & Grill',
        }),
      ],
    });
    expect(move.kind).toBe('code_expired');
    expect(move.actionHref).toBe('/challenges/show/expired');
    expect(move.actionLabel).toBe('Get a new code');
  });

  it('opens the latest verified visit that has no note', () => {
    const move = selectNextMove({
      now: NOW,
      hasPair: true,
      xp: 200,
      nextLevelName: 'The Explorer',
      nextLevelXp: 300,
      noPair: GENERATE,
      adventures: [
        adventure({
          id: 'older',
          redemptionId: 'older',
          visitStatus: 'verified',
          restaurantName: 'Older',
          occurredAt: '2026-02-02T18:00:00.000Z',
        }),
        adventure({
          id: 'newer',
          redemptionId: 'newer',
          visitStatus: 'verified',
          restaurantName: 'Cadillac Pizza Pub',
          occurredAt: '2026-04-26T18:00:00.000Z',
        }),
        adventure({ id: 'noted', redemptionId: 'noted', visitStatus: 'note_added', restaurantName: 'Noted' }),
      ],
    });
    expect(move.kind).toBe('add_memory');
    expect(move.actionLabel).toBe('Add memory');
    expect(move.actionHref).toContain('/journal/notes/newer');
    expect(decodeURIComponent(move.actionHref)).toContain('return=/journey');
    expect(move.sentence).toContain('Cadillac Pizza Pub');
  });

  it('opens Challenges for the lowest ready slot and names the next level when 100 XP reaches it', () => {
    const move = selectNextMove({
      now: NOW,
      hasPair: true,
      xp: 200,
      nextLevelName: 'The Explorer',
      nextLevelXp: 300,
      noPair: GENERATE,
      adventures: [
        adventure({ id: 'b', visitStatus: 'ready', restaurantName: 'Second', slotNumber: 2 }),
        adventure({ id: 'a', visitStatus: 'ready', restaurantName: 'The Common Table', slotNumber: 1 }),
      ],
    });
    expect(move.kind).toBe('ready');
    expect(move.actionHref).toBe('/challenges');
    expect(move.actionLabel).toBe('Open challenge');
    expect(move.sentence).toContain('The Common Table');
    expect(move.accent).toBe('The Explorer.');
    expect(move.meta).toContain('+100 XP');
  });

  it('uses the existing Challenges CTA when there is no pair', () => {
    for (const cta of [
      noPairCta({
        launchEligible: false,
        creditsWorkflow: false,
        pendingCreditsCount: 0,
        generateBlocked: false,
      }),
      noPairCta({
        launchEligible: true,
        creditsWorkflow: true,
        pendingCreditsCount: 2,
        generateBlocked: false,
      }),
      noPairCta({
        launchEligible: true,
        creditsWorkflow: false,
        pendingCreditsCount: 0,
        generateBlocked: true,
      }),
      GENERATE,
    ] satisfies NoPairCta[]) {
      const move = selectNextMove({
        now: NOW,
        hasPair: false,
        xp: 0,
        nextLevelName: null,
        nextLevelXp: null,
        noPair: cta,
        adventures: [],
      });
      expect(move.kind).toBe('no_pair');
      expect(move.actionHref).toBe(cta.actionHref);
      expect(move.actionLabel).toBe(cta.actionLabel);
      expect(move.sentence).toBe(cta.sentence);
    }
    expect(GENERATE.actionLabel).toBe('Generate Challenge');
  });

  it('keeps an issued code, an expired code, a memory, and a ready challenge ahead of no pair', () => {
    const creditsWaiting = noPairCta({
      launchEligible: true,
      creditsWorkflow: true,
      pendingCreditsCount: 2,
      generateBlocked: true,
    });
    const cases = [
      {
        kind: 'code_issued' as const,
        adventure: adventure({
          id: 'code',
          redemptionId: 'code',
          restaurantName: 'Code',
          visitStatus: 'code_issued',
          expiresAt: '2026-11-04T01:00:00.000Z',
        }),
      },
      {
        kind: 'code_expired' as const,
        adventure: adventure({
          id: 'expired',
          redemptionId: 'expired',
          restaurantName: 'Expired',
          visitStatus: 'code_expired',
        }),
      },
      {
        kind: 'add_memory' as const,
        adventure: adventure({
          id: 'memory',
          redemptionId: 'memory',
          restaurantName: 'Memory',
          visitStatus: 'verified',
          occurredAt: '2026-04-26T18:00:00.000Z',
        }),
      },
      {
        kind: 'ready' as const,
        adventure: adventure({
          id: 'ready',
          restaurantName: 'Ready',
          visitStatus: 'ready',
          slotNumber: 1,
        }),
      },
    ];
    for (const entry of cases) {
      const move = selectNextMove({
        now: NOW,
        hasPair: true,
        xp: 0,
        nextLevelName: null,
        nextLevelXp: null,
        noPair: creditsWaiting,
        adventures: [entry.adventure],
      });
      expect(move.kind).toBe(entry.kind);
    }
  });

  it('sends a finished pair to Discover', () => {
    const move = selectNextMove({
      now: NOW,
      hasPair: true,
      xp: 200,
      nextLevelName: 'The Explorer',
      nextLevelXp: 300,
      noPair: GENERATE,
      adventures: [
        adventure({ id: 'noted', redemptionId: 'noted', visitStatus: 'note_added', restaurantName: 'The Yard' }),
      ],
    });
    expect(move.kind).toBe('caught_up');
    expect(move.actionHref).toBe('/roulette');
  });
});

describe('noPairCta', () => {
  it('holds an out-of-area member on area hold before credits, reveal, or generate', () => {
    const cta = noPairCta({
      launchEligible: false,
      creditsWorkflow: true,
      pendingCreditsCount: 2,
      generateBlocked: true,
    });
    expect(cta.id).toBe('area_hold');
    expect(cta.sentence).toBe(AREA_HOLD_HEADING);
    expect(cta.actionHref).toBe('/challenges');
    expect(cta.actionLabel).toBe('See challenges');
  });

  it('shows credits waiting only when this month has a pending credit, and that wins over reveal', () => {
    const one = noPairCta({
      launchEligible: true,
      creditsWorkflow: true,
      pendingCreditsCount: 1,
      generateBlocked: true,
    });
    expect(one.id).toBe('credits_waiting');
    expect(one.sentence).toBe('Your credits are waiting.');
    expect(one.meta).toBe('Restaurant selection is not open yet');
    expect(one.actionLabel).toBe('Open challenges');
    expect(one.actionHref).toBe('/challenges');

    const two = noPairCta({
      launchEligible: true,
      creditsWorkflow: true,
      pendingCreditsCount: 2,
      generateBlocked: true,
    });
    expect(two.id).toBe('credits_waiting');
    expect(two.meta).toBe(
      'You have 2 credits for this month. Restaurant selection is not open yet.',
    );
  });

  it('does not treat a credits member with zero pending credits as waiting', () => {
    expect(
      showsMonthlyCuration({ launchEligible: true, creditsWorkflow: true, hasCurrentPair: false }),
    ).toBe(false);
    for (const generateBlocked of [false, true]) {
      const cta = noPairCta({
        launchEligible: true,
        creditsWorkflow: true,
        pendingCreditsCount: 0,
        generateBlocked,
      });
      expect(cta.id).toBe('generate');
      expect(cta.actionLabel).toBe('Generate Challenge');
      expect(cta.sentence).toBe('Generate your two restaurant challenges for this month.');
      expect(cta.meta).toBe('No pair yet');
      expect(cta.actionHref).toBe('/challenges');
    }
  });

  it('asks a launch-eligible legacy member to reveal only while generate is blocked', () => {
    expect(
      showsMonthlyCuration({ launchEligible: true, creditsWorkflow: false, hasCurrentPair: false }),
    ).toBe(true);
    const reveal = noPairCta({
      launchEligible: true,
      creditsWorkflow: false,
      pendingCreditsCount: 2,
      generateBlocked: true,
    });
    expect(reveal.id).toBe('reveal');
    expect(reveal.sentence).toBe('Reveal your challenges.');
    expect(reveal.meta).toBe('This month’s pair is chosen on the Challenges page');
    expect(reveal.actionLabel).toBe('Go to Challenges');
    expect(reveal.actionHref).toBe('/challenges');

    const generate = noPairCta({
      launchEligible: true,
      creditsWorkflow: false,
      pendingCreditsCount: 0,
      generateBlocked: false,
    });
    expect(generate.id).toBe('generate');
    expect(generate.actionLabel).toBe('Generate Challenge');
  });

  it('renders credits waiting in the existing next-move card', () => {
    const cta = noPairCta({
      launchEligible: true,
      creditsWorkflow: true,
      pendingCreditsCount: 2,
      generateBlocked: true,
    });
    const model = buildProgressModel({
      progress: baseProgress(),
      headerLabel: 'Noah',
      now: NOW,
      activity: { ok: true, hasPair: false, adventures: [], noPair: cta },
    });
    render(<ProgressView model={model} />);
    expect(model.nextMove?.kind).toBe('no_pair');
    expect(model.nextMove?.accent).toBeNull();
    expect(screen.getByText('Your credits are waiting.')).toBeTruthy();
    expect(screen.getByText(/You have 2 credits for this month/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open challenges' }).getAttribute('href')).toBe('/challenges');
    expect(screen.queryByText('Generate Challenge')).toBeNull();
  });

  it('gates the Challenges hold on a pending count and keeps the two-credit sentence at 2', () => {
    expect(challengesCreditHold(0)).toBeNull();
    expect(challengesCreditHold(1)).toEqual({ pendingCount: 1 });
    expect(challengesCreditHold(2)).toEqual({ pendingCount: 2 });

    const launchEligible = (pendingCreditsCount: number) =>
      noPairCta({
        launchEligible: true,
        creditsWorkflow: true,
        pendingCreditsCount,
        generateBlocked: false,
      });
    expect(launchEligible(0).id).toBe('generate');
    expect(launchEligible(1).id).toBe('credits_waiting');
    expect(launchEligible(1).meta).toBe('Restaurant selection is not open yet');
    expect(launchEligible(2).id).toBe('credits_waiting');
    expect(launchEligible(2).meta).toBe(
      'You have 2 credits for this month. Restaurant selection is not open yet.',
    );

    const outOfArea = noPairCta({
      launchEligible: false,
      creditsWorkflow: true,
      pendingCreditsCount: 2,
      generateBlocked: false,
    });
    expect(outOfArea.id).toBe('area_hold');
    expect(challengesCreditHold(2)).toEqual({ pendingCount: 2 });

    const page = readFileSync(path.join(ROOT, 'src/app/(site)/challenges/page.tsx'), 'utf8');
    const filtersAt = page.indexOf('pendingCreditsHeadFilters(');
    const failedAt = page.indexOf('Failed to load credits:');
    const holdAt = page.indexOf('challengesCreditHold(');
    const carriedAt = page.indexOf('loadCarriedCreditsForUser(');
    expect(filtersAt).toBeGreaterThan(-1);
    expect(page).toContain('loadCreditsSwapRemaining(');
    expect(failedAt).toBeGreaterThan(filtersAt);
    expect(holdAt).toBeGreaterThan(failedAt);
    expect(carriedAt).toBeGreaterThan(holdAt);
    expect(page).not.toContain('creditHold = { pendingCount: count ?? 0 }');
    expect(page).not.toContain('blockMemberGenerate');
  });

  it('uses the Chicago month for the pending-credit issue period across the UTC date line', () => {
    const lastNight = new Date('2026-11-01T04:30:00.000Z');
    expect(chicagoMonthStart(lastNight)).toBe('2026-10-01');
    expect(pendingCreditsHeadFilters('member-1', lastNight)).toEqual({
      userId: 'member-1',
      issuePeriod: '2026-10-01',
      status: 'pending',
    });
    const chicagoMidnight = new Date('2026-11-01T06:00:00.000Z');
    expect(chicagoMonthStart(chicagoMidnight)).toBe('2026-11-01');
    expect(pendingCreditsHeadFilters('member-1', chicagoMidnight).issuePeriod).toBe('2026-11-01');
  });
});

describe('Chicago month window', () => {
  it('keeps 11:30 PM Chicago on the last day inside that month', () => {
    const lastNight = new Date('2026-11-01T04:30:00.000Z');
    expect(chicagoMonthStart(lastNight)).toBe('2026-10-01');
    const months = buildStreakMonths({
      now: lastNight,
      verifiedAt: [lastNight.toISOString()],
    });
    expect(months.map((month) => month.label)).toEqual(['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
    expect(months.at(-1)).toMatchObject({
      key: '2026-10-01',
      verified: true,
      current: true,
      pending: false,
    });
    expect(nextChicagoMonth('2026-10-01')).toBe('2026-11-01');
    expect(previousChicagoMonth(nextChicagoMonth('2026-12-01'))).toBe('2026-12-01');
    expect(nextChicagoMonth(previousChicagoMonth('2026-01-01'))).toBe('2026-01-01');
  });
});

describe('Progress page', () => {
  it('shows tier edges and hides the next target at max level', () => {
    expect(panel(0)).toMatch(/300 to The Explorer/);
    expect(panel(299)).toMatch(/1 to The Explorer/);
    expect(panel(300)).toMatch(/Level 1 · The Explorer/);
    expect(panel(300)).toMatch(/700 to The Tastemaker/);
    expect(panel(999)).toMatch(/1 to The Tastemaker/);
    expect(panel(1000)).toMatch(/Level 2 · The Tastemaker/);
    expect(panel(1000)).toMatch(/500 to The Connoisseur/);
    expect(panel(2500)).toMatch(/Max level/);
    expect(panel(2500)).not.toMatch(/to The/);
    expect(panel(2600)).toMatch(/Max level/);
    expect(panel(2600)).not.toMatch(/to The/);
    expect(screen.getByText('100 XP for every verified visit')).toBeTruthy();
  });

  it('labels savings estimated only when the read says so', () => {
    render(<ProgressView model={readyModel({ xp: 0 })} />);
    expect(screen.getByText(/\(estimated\)/)).toBeTruthy();
    cleanup();
    render(
      <ProgressView
        model={readyModel({ xp: 0, savings: { amount: 20, isEstimate: false, corrected: false } })}
      />,
    );
    expect(screen.queryByText(/estimated/i)).toBeNull();
    expect(screen.getByText('$20')).toBeTruthy();
    expect(screen.queryByText('Corrected after review')).toBeNull();
    cleanup();
    render(
      <ProgressView
        model={readyModel({
          xp: 0,
          savings: { amount: 25, isEstimate: false, corrected: true },
        })}
      />,
    );
    expect(screen.getByText('$25')).toBeTruthy();
    expect(screen.getByText(/Corrected after review/)).toBeTruthy();
  });

  it('shows the unavailable message and a retry link instead of zeros', () => {
    render(<ProgressUnavailable headerLabel="Noah" />);
    expect(screen.getByText(PROGRESS_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retry' }).getAttribute('href')).toBe('/journey');
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('$0')).toBeNull();
    expect(screen.queryByText(/verified visits/)).toBeNull();
  });

  it('shows an empty visit list without sample restaurants', () => {
    render(<ProgressView model={readyModel({ xp: 0 })} />);
    expect(screen.getByText('No visits yet. A verified visit will show up here.')).toBeTruthy();
    expect(screen.queryByText('The Common Table')).toBeNull();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('shows one medallion per id, with earned dates and locked progress', () => {
    const badges: MemberBadge[] = [
      badge('first_bite', 'First Bite', '2026-02-02T18:00:00.000Z', 1, 1),
      badge('first_bite', 'First Bite copy', '2026-02-02T18:00:00.000Z', 1, 1),
      badge('hat_trick', 'Hat Trick', null, 2, 3),
    ];
    render(<ProgressView model={readyModel({ xp: 200, badges })} />);
    expect(screen.getAllByText('First Bite')).toHaveLength(1);
    expect(screen.queryByText('First Bite copy')).toBeNull();
    expect(screen.getByText('Earned on Feb 2, 2026')).toBeTruthy();
    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('opens the level road from the keyboard button', () => {
    render(<ProgressView model={readyModel({ xp: 1000 })} />);
    const button = screen.getByRole('button', { name: /Road to Local Legend/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    for (const tier of XP_LEVELS) {
      expect(screen.getAllByText(`${tier.minXp} XP`).length).toBeGreaterThan(0);
      expect(screen.getAllByText(new RegExp(tier.name)).length).toBeGreaterThan(0);
    }
  });

  it('keeps a pending code out of the visit count and links the next move to it', () => {
    const issued = assembleProgressAdventures({
      now: NOW,
      noteRedemptionIds: new Set(),
      restaurants: [
        {
          id: 'rest-zen',
          name: 'Zen Sushi & Grill',
          neighborhood: 'Stonebridge',
          imageUrl: null,
          googlePlaceId: null,
        },
      ],
      items: [
        {
          id: 'item-zen',
          status: 'redeemed',
          redemptionDeadline: '2026-12-01T00:00:00.000Z',
          slotNumber: 1,
          restaurantId: 'rest-zen',
        },
      ],
      redemptions: [
        {
          id: 'red-zen',
          status: 'issued',
          verifiedAt: null,
          expiresAt: '2026-11-04T00:15:00.000Z',
          createdAt: '2026-11-03T23:00:00.000Z',
          restaurantId: 'rest-zen',
          challengeItemId: 'item-zen',
        },
      ],
    });
    expect(issued.map((row) => row.visitStatus)).toEqual(['code_issued']);
    const model = buildProgressModel({
      progress: baseProgress({ xp: 0, verifiedVisits: 0, pendingVisits: 1 }),
      headerLabel: 'Noah',
      now: NOW,
      activity: { ok: true, hasPair: true, adventures: issued, noPair: GENERATE },
    });
    render(<ProgressView model={model} />);
    expect(screen.getByRole('link', { name: 'Show code' }).getAttribute('href')).toBe(
      '/challenges/show/red-zen',
    );
    expect(screen.getByText('Code issued')).toBeTruthy();
    expect(screen.getByText(/\+1 pending/)).toBeTruthy();
    const visits = screen.getAllByText('0');
    expect(visits.length).toBeGreaterThan(0);
  });

  it('links Add memory back to /journey', () => {
    const model = buildProgressModel({
      progress: baseProgress({ xp: 100, verifiedVisits: 1 }),
      headerLabel: 'Noah',
      now: NOW,
      activity: {
        ok: true,
        hasPair: true,
        noPair: GENERATE,
        adventures: [
          adventure({
            id: '33333333-3333-4333-8333-333333333333',
            redemptionId: '33333333-3333-4333-8333-333333333333',
            visitStatus: 'verified',
            restaurantName: 'Cadillac Pizza Pub',
            occurredAt: '2026-02-02T18:00:00.000Z',
            verifiedAt: '2026-02-02T18:00:00.000Z',
          }),
        ],
      },
    });
    render(<ProgressView model={model} />);
    const links = screen.getAllByRole('link', { name: 'Add memory' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(href).toContain('/journal/notes/33333333-3333-4333-8333-333333333333');
      expect(decodeURIComponent(href)).toContain('return=/journey');
    }
  });
});

describe('Progress label', () => {
  it('keeps Progress, Journal, and Passport as separate destinations', () => {
    expect(MEMBER_NAV_ITEMS.map((item) => [item.label, item.href])).toEqual([
      ['Discover', '/roulette'],
      ['Restaurants', '/restaurants'],
      ['Challenges', '/challenges'],
      ['Progress', '/journey'],
      ['Journal', '/journal'],
      ['Passport', '/journey?view=passport'],
    ]);
    expect(MY_JOURNEY_VIEW_LABELS.journey).toBe('Progress');
    expect(MY_JOURNEY_VIEW_LABELS.journal).toBe('Journal');
    expect(MY_JOURNEY_VIEW_LABELS.passport).toBe('Passport');
    expect(parseMyJourneyView(undefined)).toBe('journey');
    expect(parseMyJourneyView('journal')).toBe('journal');
    expect(parseMyJourneyView('passport')).toBe('passport');
    expect(parseMyJourneyView('progress')).toBe('journey');
    expect(myJourneyHref('journey')).toBe('/journey');
    expect(myJourneyHref('journal')).toBe('/journal');
    expect(myJourneyHref('passport')).toBe('/journey?view=passport');

    const page = readFileSync(path.join(ROOT, 'src/app/(site)/journey/page.tsx'), 'utf8');
    expect(page).not.toContain('MyJourneyHub');
    expect(page).not.toContain('JourneySectionTabs');
    expect(page).not.toContain('Timeline');
    expect(page).toContain("redirect('/journal')");
    expect(page).toContain('redirect(`/signin?redirectTo=${encodeURIComponent(redirectTo)}`)');
    expect(page).toContain('<PassportContent');
    expect(page).not.toContain('<JournalContent');
    render(<ProgressView model={readyModel()} />);
    expect(screen.queryByRole('tablist', { name: 'Progress sections' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Journal' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Passport' })).toBeNull();
    cleanup();

    const journal = readFileSync(path.join(ROOT, 'src/app/(site)/journal/page.tsx'), 'utf8');
    expect(journal).toContain("title: 'Journal'");
    expect(journal).toContain('<JournalContent');
    expect(journal).not.toContain("redirect('/journey?view=journal')");

    const css = readFileSync(path.join(ROOT, 'src/app/styles/wanderbite-theme.css'), 'utf8');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.wb-spin');
    expect(reduced).toContain('.wb-shine');
    expect(reduced).toContain('.wb-xp-fill');
    expect(reduced).toContain('.wb-aurora');
  });

  it('never uses an email as the greeting name', () => {
    expect(headerLabelFor('ada@example.com')).toBe('Welcome back');
    expect(headerLabelFor('Noah Devine')).toBe('Noah');
  });
});

function panel(xp: number): string {
  cleanup();
  const view = render(<ProgressView model={readyModel({ xp })} />);
  return view.container.textContent ?? '';
}

function readyModel(
  overrides: Partial<Exclude<MemberProgress, { error: 'progress_unavailable' }>> = {},
) {
  return buildProgressModel({
    progress: baseProgress(overrides),
    headerLabel: 'Noah',
    now: NOW,
    activity: { ok: true, hasPair: true, adventures: [], noPair: GENERATE },
  });
}

function baseProgress(
  overrides: Partial<Exclude<MemberProgress, { error: 'progress_unavailable' }>> = {},
): Exclude<MemberProgress, { error: 'progress_unavailable' }> {
  const xp = overrides.xp ?? 0;
  const level = levelFromXp(xp);
  return {
    verifiedVisits: 0,
    pendingVisits: 0,
    uniqueRestaurants: 0,
    neighborhoods: 0,
    currentMonthlyStreak: 0,
    longestStreak: 0,
    totalMonthsActive: 0,
    xp,
    level: level.level,
    nextLevel: level.nextLevel,
    badges: [],
    savings: { amount: 0, isEstimate: true, corrected: false },
    ...overrides,
  };
}

function badge(
  id: string,
  name: string,
  earnedAt: string | null,
  current: number,
  target: number,
): MemberBadge {
  return {
    id,
    name,
    earnedAt,
    progress: { current, target },
    description: name,
    icon: '★',
  };
}

function adventure(overrides: Partial<ProgressAdventure> & Pick<ProgressAdventure, 'id' | 'visitStatus' | 'restaurantName'>): ProgressAdventure {
  return {
    redemptionId: null,
    neighborhood: null,
    imageUrl: '/images/restaurant-placeholder.jpg',
    occurredAt: null,
    verifiedAt: null,
    expiresAt: null,
    deadline: null,
    slotNumber: null,
    ...overrides,
  };
}
