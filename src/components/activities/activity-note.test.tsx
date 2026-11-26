import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratedChallengeItem } from '@/app/actions/generate-challenge';
import { ActivityNoteBlock } from '@/components/activities/activity-note';
import { ACTIVITY_NOTE_HEADING } from '@/lib/activities/types';
import { AdventureTicket } from '@/components/challenges/adventure-ticket';
import { RestaurantCard } from '@/components/dashboard/restaurant-card';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/actions/get-redemption-code', () => ({
  getRedemptionCode: vi.fn(async () => ({ state: 'issued', code: 'WB-TEST' })),
}));

vi.mock('@/app/actions/bite-notes', () => ({
  saveBiteNote: vi.fn(),
  toggleNoteVisibility: vi.fn(),
}));

vi.mock('@/components/restaurants/restaurant-reviews', () => ({
  RestaurantReviews: () => null,
}));

vi.mock('@/components/restaurants/restaurant-photo', () => ({
  RestaurantPhoto: () => null,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const NOTE =
  'After dinner, you could wander through Chestnut Square Village and let the meal settle while you walk. It is a small detour that keeps the night easy.';

function item(status: 'assigned' | 'redeemed' = 'assigned'): GeneratedChallengeItem {
  return {
    challengeItem: {
      id: 'item-1',
      cycle_id: 'cycle-1',
      restaurant_id: 'rest-a',
      slot_number: 1,
      status,
      redemption_deadline: '2026-12-01T00:00:00.000Z',
    },
    restaurant: {
      id: 'rest-a',
      name: 'Alpha Kitchen',
      cuisine_tags: ['thai'],
      address: '1 Sample St, McKinney, TX 75069',
      lat: 33.1972,
      lon: -96.6156,
      status: 'active',
      market_id: 'market-1',
      org_id: 'org-1',
    },
    offer: { available: true, discount_amount_cents: 2000, min_spend_cents: 5000 },
    redemptionId: status === 'redeemed' ? 'redemption-1' : null,
    visitStatus: status === 'redeemed' ? 'code_issued' : 'ready',
  };
}

describe('activity note on the card and ticket', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function render(node: ReactElement) {
    await act(async () => {
      root.render(node);
    });
    return container;
  }

  it('renders nothing for an empty note and no link for a real one', async () => {
    const empty = await render(<ActivityNoteBlock headingId="note-empty" body={null} />);
    expect(empty.textContent).toBe('');
    const shown = await render(<ActivityNoteBlock headingId="note-shown" body={NOTE} />);
    const section = shown.querySelector('[data-activity-note]');
    expect(section?.textContent).toContain(ACTIVITY_NOTE_HEADING);
    expect(section?.textContent).toContain('Chestnut Square Village');
    expect(section?.querySelector('a')).toBeNull();
    expect(section?.className).toContain('scroll-mb-28');
    expect(section?.className).not.toContain('fixed');
    expect(section?.className).not.toContain('absolute');
  });

  it('italicizes matching names and renders unmatched or markup-like text as plain text', async () => {
    const named = await render(
      <ActivityNoteBlock
        headingId="note-names"
        body="Alpha Kitchen sits near Chestnut Square Village after the meal. The night stays easy."
        names={['Chestnut Square Village', 'Alpha Kitchen']}
      />,
    );
    expect([...named.querySelectorAll('em')].map((node) => node.textContent)).toEqual([
      'Alpha Kitchen',
      'Chestnut Square Village',
    ]);
    expect(named.querySelector('[data-activity-note]')?.innerHTML).not.toContain('dangerouslySetInnerHTML');

    const plain = await render(
      <ActivityNoteBlock
        headingId="note-plain"
        body="The night stays easy after the meal and the walk home."
        names={['Chestnut Square Village']}
      />,
    );
    expect(plain.querySelector('em')).toBeNull();
    expect(plain.querySelector('[data-activity-note] p')?.textContent).toBe(
      'The night stays easy after the meal and the walk home.',
    );

    const hostile = '<script>alert(1)</script>';
    const injected = await render(
      <ActivityNoteBlock
        headingId="note-html"
        body={`Look at ${hostile} and keep the night easy.`}
        names={[hostile]}
      />,
    );
    expect(injected.querySelector('script')).toBeNull();
    expect(injected.innerHTML).not.toContain('<script');
    expect(injected.textContent).toContain(hostile);
    expect(injected.querySelector('em')?.textContent).toBe(hostile);
  });

  it('keeps fact boxes when notes mode is off and hides them when the note is missing', async () => {
    const facts = await render(
      <RestaurantCard
        item={item()}
        cycleCreatedAt="2026-11-01T18:00:00.000Z"
        canSwap={false}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
        activities={[{
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Sample Square Walk',
          categoryLabel: 'Walk',
          durationLabel: null,
          costLabel: 'Free',
          hoursLabel: 'Check hours on their site',
          hoursKnown: false,
          sourceUrl: 'https://example.com/sample',
          sampleLabel: 'Sample',
          weatherLabel: null,
          bookingLabel: null,
          locationMethod: 'coordinates',
        }]}
      />,
    );
    expect(facts.textContent).toContain('Optional nearby idea');
    expect(facts.textContent).not.toContain(ACTIVITY_NOTE_HEADING);

    const absent = await render(
      <RestaurantCard
        item={item()}
        cycleCreatedAt="2026-11-01T18:00:00.000Z"
        canSwap={false}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
        activities={[{
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Sample Square Walk',
          categoryLabel: 'Walk',
          durationLabel: null,
          costLabel: 'Free',
          hoursLabel: 'Check hours on their site',
          hoursKnown: false,
          sourceUrl: 'https://example.com/sample',
          sampleLabel: null,
          weatherLabel: null,
          bookingLabel: null,
          locationMethod: 'coordinates',
        }]}
        activityNotesMode
        activityNote={null}
      />,
    );
    expect(absent.textContent).not.toContain('Optional nearby idea');
    expect(absent.textContent).not.toContain(ACTIVITY_NOTE_HEADING);
    expect(absent.querySelector('[data-activity-note]')).toBeNull();
  });

  it('places the note below Show code to server on the card and the ticket', async () => {
    const card = await render(
      <RestaurantCard
        item={item('redeemed')}
        cycleCreatedAt="2026-11-01T18:00:00.000Z"
        canSwap={false}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
        activityNotesMode
        activityNote={NOTE}
      />,
    );
    const cardText = card.textContent ?? '';
    expect(cardText.indexOf('Show code to server')).toBeGreaterThan(-1);
    expect(cardText.indexOf('Show code to server')).toBeLessThan(cardText.indexOf(ACTIVITY_NOTE_HEADING));
    expect(card.querySelector('[data-activity-note] a')).toBeNull();

    const ticket = await render(
      <AdventureTicket
        item={item('redeemed')}
        cycleCreatedAt="2026-11-01T18:00:00.000Z"
        canSwap={false}
        swapsRemaining={1}
        isSwapping={false}
        isRedeeming={false}
        onSwap={() => undefined}
        onRedeem={() => undefined}
        activityNotesMode
        activityNote="Alpha Kitchen keeps the night easy after the meal."
        activityNoteNames={['Chestnut Square Village']}
      />,
    );
    const ticketText = ticket.textContent ?? '';
    expect(ticketText.indexOf('Show code to your server')).toBeLessThan(ticketText.indexOf(ACTIVITY_NOTE_HEADING));
    expect(ticket.querySelector('[data-activity-note] a')).toBeNull();
    expect(ticket.querySelector('[data-activity-note] em')?.textContent).toBe('Alpha Kitchen');
  });
});
