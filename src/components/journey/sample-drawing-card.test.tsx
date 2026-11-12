import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemberProgressionPanel } from '@/components/journey/progression-panel';
import {
  SAMPLE_DRAWING_BANNER,
  SAMPLE_DRAWING_NOT_DRAWN,
  SAMPLE_DRAWING_NOT_PICKED,
  SAMPLE_DRAWING_UNAVAILABLE,
  SampleDrawingCard,
  formatSampleValue,
  samplePickedLine,
  samplePrizeLine,
} from '@/components/journey/sample-drawing-card';
import { DRAWING_ENTRIES_NOTE } from '@/lib/progression/format';
import type { MemberProgressionSummary } from '@/lib/progression/read-model';
import type { MemberSampleDrawing } from '@/lib/drawings/member-drawing-read-model';

const summary: MemberProgressionSummary = {
  xp: 0,
  visits: 0,
  level: 1,
  name: 'Explorer',
  nextLevel: null,
  progressPercent: 0,
  milestones: [],
  entriesByQuarter: [{ quarterKey: '2027-Q1', count: 3 }],
  consistent: true,
  ignored: { events: 0, milestones: 0, entries: 0 },
};

function campaign(result: 'not_drawn' | 'picked' | 'not_picked'): MemberSampleDrawing {
  return {
    kind: 'campaign',
    quarterKey: '2027-Q1',
    startsOn: 'Jan 1, 2027',
    endsOn: 'Mar 31, 2027',
    status: result === 'not_drawn' ? 'active' : 'closed',
    prizes: [{ label: 'Sample prize: Dinner for two', quantity: 2, sampleValueCents: 4000 }],
    entryCount: 3,
    result,
    ...(result === 'picked' ? { pickedPrizeLabel: 'Sample prize: Dinner for two' } : {}),
  };
}

afterEach(() => {
  cleanup();
});

describe('SampleDrawingCard', () => {
  it('formats the sample prize and the entry count', () => {
    expect(samplePrizeLine({ label: 'Sample prize: Dinner for two', quantity: 2, sampleValueCents: 4000 })).toBe(
      'Sample prize: Dinner for two \u00d72 \u00b7 Sample value $40',
    );
    expect(formatSampleValue(4050)).toBe('$40.50');
    expect(samplePickedLine('Sample prize: Dinner for two')).toBe(
      'In this simulated drawing you were picked for Sample prize: Dinner for two',
    );
  });

  it('renders the banner, the quarter, the prize, and each result', () => {
    const notDrawn = render(<SampleDrawingCard drawing={campaign('not_drawn')} />);
    expect(screen.getByRole('heading', { name: 'Sample drawing' })).toBeTruthy();
    expect(screen.getByText(SAMPLE_DRAWING_BANNER)).toBeTruthy();
    expect(screen.getByText('Jan 1, 2027 \u2013 Mar 31, 2027')).toBeTruthy();
    expect(screen.getByText('Sample prize: Dinner for two \u00d72 \u00b7 Sample value $40')).toBeTruthy();
    expect(screen.getByText('3 entries this quarter')).toBeTruthy();
    expect(screen.getByText(SAMPLE_DRAWING_NOT_DRAWN)).toBeTruthy();
    expect(notDrawn.container.innerHTML).not.toMatch(/fulfill|forfeit|rank|seed|run_by|actual_cost/i);
    notDrawn.unmount();

    render(<SampleDrawingCard drawing={campaign('picked')} />);
    expect(
      screen.getByText('In this simulated drawing you were picked for Sample prize: Dinner for two'),
    ).toBeTruthy();
    expect(screen.queryByText(/fulfill|forfeit|rank|seed/i)).toBeNull();
    cleanup();

    render(<SampleDrawingCard drawing={campaign('not_picked')} />);
    expect(screen.getByText(SAMPLE_DRAWING_NOT_PICKED)).toBeTruthy();
    expect(document.body.textContent).not.toContain('prize_id');
    expect(document.body.textContent).not.toContain('user_id');
  });

  it('renders nothing for none and a quiet line when the read is unavailable', () => {
    const none = render(<SampleDrawingCard drawing={{ kind: 'none' }} />);
    expect(none.container.textContent).toBe('');
    none.unmount();

    render(<SampleDrawingCard drawing={{ kind: 'unavailable' }} />);
    expect(screen.getByRole('status').textContent).toBe(SAMPLE_DRAWING_UNAVAILABLE);
  });

  it('sits inside the levels panel and leaves the drawing-entries note in place', () => {
    const { container } = render(
      <MemberProgressionPanel summary={summary} sampleDrawing={campaign('not_drawn')} />,
    );
    const panel = screen.getByRole('heading', { name: 'Levels and drawing entries' }).closest('section');
    expect(panel?.textContent).toContain(SAMPLE_DRAWING_BANNER);
    expect(panel?.textContent).toContain(DRAWING_ENTRIES_NOTE);
    expect(panel?.textContent).toContain('3 entries this quarter');
    expect(container.innerHTML).not.toMatch(/fulfill|forfeit|seed|run_by|actual_cost/i);

    cleanup();
    render(<MemberProgressionPanel summary={summary} sampleDrawing={{ kind: 'unavailable' }} />);
    expect(screen.getByRole('heading', { name: 'Levels and drawing entries' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(SAMPLE_DRAWING_UNAVAILABLE);
    expect(screen.getByText(DRAWING_ENTRIES_NOTE)).toBeTruthy();

    cleanup();
    render(<MemberProgressionPanel summary={summary} />);
    expect(screen.queryByText(SAMPLE_DRAWING_BANNER)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sample drawing' })).toBeNull();
  });
});
