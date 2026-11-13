import type { MemberSampleDrawing } from '@/lib/drawings/member-drawing-read-model';
import { pluralize } from '@/lib/format/text';

export const SAMPLE_DRAWING_HEADING = 'Sample drawing';

export const SAMPLE_DRAWING_BANNER =
  'Sample drawing — for demonstration only, not a real promotion. No prizes will be sent.';

export const SAMPLE_DRAWING_UNAVAILABLE = 'Sample drawing unavailable';

export const SAMPLE_DRAWING_NOT_DRAWN = "This simulated drawing hasn't been run.";

export const SAMPLE_DRAWING_CLOSED = 'This sample drawing is closed.';

export const SAMPLE_DRAWING_CLOSED_NOT_RUN = 'This sample drawing closed without being run.';

export const SAMPLE_DRAWING_NOT_PICKED = "You weren't picked in this simulated drawing.";

const DOLLAR_GROUPS = new Intl.NumberFormat('en-US');

/** Whole dollars drop the cents. $40.50 keeps two places. */
export function formatSampleValue(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const grouped = DOLLAR_GROUPS.format(dollars);
  const body = remainder === 0 ? `$${grouped}` : `$${grouped}.${String(remainder).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

export function samplePrizeLine(prize: {
  label: string;
  quantity: number;
  sampleValueCents: number;
}): string {
  return `${prize.label} \u00d7${prize.quantity} \u00b7 Sample value ${formatSampleValue(prize.sampleValueCents)}`;
}

export function sampleEntryLine(count: number): string {
  return `${pluralize(count, 'entry', 'entries')} this quarter`;
}

export function samplePickedLine(label: string): string {
  return `In this simulated drawing you were picked for ${label}`;
}

export function sampleForfeitedLine(label: string): string {
  return `In this simulated drawing you were picked for ${label}, but this sample prize was forfeited.`;
}

export function sampleDateLine(startsOn: string, endsOn: string): string {
  return `${startsOn} \u2013 ${endsOn}`;
}

type SampleDrawingCardProps = {
  drawing: MemberSampleDrawing;
};

/**
 * Read-only sample campaign for the signed-in member.
 * The drawing value is already filtered. This does not read or write.
 */
export function SampleDrawingCard({ drawing }: SampleDrawingCardProps) {
  if (drawing.kind === 'none') return null;
  if (drawing.kind === 'unavailable') {
    return (
      <p role="status" className="m-0 text-sm text-wb-muted">
        {SAMPLE_DRAWING_UNAVAILABLE}
      </p>
    );
  }

  const prizeLabel = drawing.pickedPrizeLabel ?? 'Sample prize';
  const result =
    drawing.result === 'forfeited'
      ? sampleForfeitedLine(prizeLabel)
      : drawing.result === 'picked'
        ? samplePickedLine(prizeLabel)
        : drawing.result === 'not_picked'
          ? SAMPLE_DRAWING_NOT_PICKED
          : drawing.status === 'closed'
            ? SAMPLE_DRAWING_CLOSED_NOT_RUN
            : SAMPLE_DRAWING_NOT_DRAWN;

  return (
    <section aria-labelledby="sample-drawing-heading" className="flex min-w-0 flex-col gap-2">
      <h3 id="sample-drawing-heading" className="m-0 text-base font-semibold text-wb-ink">
        {SAMPLE_DRAWING_HEADING}
      </h3>
      <p className="m-0 rounded-xl bg-wb-wait-bg px-3 py-2 text-sm font-semibold text-wb-wait-fg">
        {SAMPLE_DRAWING_BANNER}
      </p>
      {drawing.status === 'closed' ? (
        <p className="m-0 text-sm text-wb-ink">{SAMPLE_DRAWING_CLOSED}</p>
      ) : null}
      <p className="m-0 text-sm text-wb-ink">{sampleDateLine(drawing.startsOn, drawing.endsOn)}</p>
      {drawing.prizes.length === 0 ? null : (
        <ul aria-label="Sample prizes" className="m-0 flex list-none flex-col gap-1 p-0">
          {drawing.prizes.map((prize, index) => (
            <li key={`${index}-${prize.label}`} className="break-words text-sm text-wb-ink">
              {samplePrizeLine(prize)}
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-sm text-wb-ink">{sampleEntryLine(drawing.entryCount)}</p>
      <p className="m-0 text-sm text-wb-ink">{result}</p>
    </section>
  );
}
