import { describe, expect, it } from 'vitest';
import { encodeDiscoverSse, type DiscoverEvent } from '@/lib/discover/events';
import { feedDiscoverSse, finishDiscoverSse, parseDiscoverSseStream } from '@/lib/discover/sse-client';

const events: DiscoverEvent[] = [
  { type: 'step', id: 'parse', label: 'Reading your vibe', constraints: [] },
  {
    type: 'step',
    id: 'filter',
    label: 'Looking through 1 local partners',
    detail: 'Active partners in the launch market',
    sample: [{ id: 'rest-1', name: 'Noodle House' }],
    total: 1,
  },
  {
    type: 'pick',
    partner: { id: 'rest-1', name: 'Noodle House' },
    reason: 'Hot noodles.',
    matched: ['Vegan'],
    unknown: [],
    unmet: [],
    isNewToMember: false,
    food: 'dumpling',
  },
];

describe('discover SSE client parser', () => {
  it('parses a full event-stream body', () => {
    const parsed = parseDiscoverSseStream(encodeDiscoverSse(events));
    expect(parsed.error).toBeNull();
    expect(parsed.events).toEqual(events);
  });

  it('keeps a split record until the blank line arrives', () => {
    const body = encodeDiscoverSse(events);
    const cut = Math.floor(body.length / 2);
    const first = feedDiscoverSse('', body.slice(0, cut));
    expect(first.error).toBeNull();
    expect(first.events.length).toBeLessThan(events.length);
    const second = feedDiscoverSse(first.rest, body.slice(cut));
    const tail = finishDiscoverSse(second.rest);
    expect(tail.error).toBeNull();
    expect([...first.events, ...second.events, ...tail.events]).toEqual(events);
  });

  it('reports a broken JSON record and ignores comment lines', () => {
    const broken = parseDiscoverSseStream('data: {"type":\n\n');
    expect(broken.error).toBeTruthy();
    const comments = parseDiscoverSseStream(
      `: keep-alive\n\n${encodeDiscoverSse([events[0]!])}`,
    );
    expect(comments.error).toBeNull();
    expect(comments.events).toEqual([events[0]]);
  });

  it('rejects a data line that is not a DiscoverEvent', () => {
    const parsed = parseDiscoverSseStream('data: {"type":"pick"}\n\n');
    expect(parsed.error).toBeTruthy();
    expect(parsed.events).toEqual([]);
  });
});
