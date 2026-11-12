import { SampleDrawingCard } from '@/components/journey/sample-drawing-card';
import type { MemberSampleDrawing } from '@/lib/drawings/member-drawing-read-model';
import { pluralize } from '@/lib/format/text';
import {
  DRAWING_ENTRIES_HEADING,
  DRAWING_ENTRIES_NOTE,
  LEVELS_REACHED_HEADING,
  MEMBER_PROGRESSION_HEADING,
  NO_DRAWING_ENTRIES_YET,
  NO_LEVELS_YET,
  PROGRESSION_UNAVAILABLE_MESSAGE,
  clampedProgressPercent,
  drawingEntryMarker,
  formatChicagoReachedDate,
  formatQuarterLabel,
  nextLevelLine,
  progressionProgressLabel,
} from '@/lib/progression/format';
import type { MemberProgressionSummary } from '@/lib/progression/read-model';

type MemberProgressionPanelProps = {
  summary: MemberProgressionSummary;
  /** Sample drawing for this quarter. Omitted when the card flag is off or there is no campaign. */
  sampleDrawing?: MemberSampleDrawing | null;
};

/**
 * Read-only levels and drawing-entry counts for the signed-in member.
 * The summary is already stored. This does not recompute a quarter, and it
 * does not mention whether the ledger matched the schedule.
 */
export function MemberProgressionPanel({ summary, sampleDrawing = null }: MemberProgressionPanelProps) {
  const percent = clampedProgressPercent(summary.progressPercent);
  const label = progressionProgressLabel(summary);
  const next = nextLevelLine(summary.nextLevel);

  return (
    <section aria-labelledby="member-progression-heading" className="flex min-w-0 flex-col gap-4">
      <h2
        id="member-progression-heading"
        className="wb-display m-0 text-[30px] leading-tight text-wb-ink"
      >
        {MEMBER_PROGRESSION_HEADING}
      </h2>

      <div className="flex min-w-0 flex-col gap-2">
        <p className="m-0 text-sm font-semibold text-wb-ink">Level {summary.level}</p>
        <p className="wb-display m-0 break-words text-[28px] leading-tight text-wb-ink">
          {summary.name}
        </p>
        <p className="font-display m-0 text-[30px] leading-none text-wb-ink">{summary.xp} XP</p>
        {next ? <p className="m-0 break-words text-sm text-wb-ink">{next}</p> : null}
        <div
          className="h-2.5 overflow-hidden rounded-full bg-wb-line"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className="wb-xp-fill h-full rounded-full"
            style={{
              width: `${percent}%`,
              background: 'linear-gradient(90deg, #8b5cf6, #f472b6)',
            }}
          />
        </div>
      </div>

      {summary.milestones.length === 0 ? (
        <p className="m-0 text-sm text-wb-muted">{NO_LEVELS_YET}</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <h3 id="member-progression-milestones" className="m-0 text-base font-semibold text-wb-ink">
            {LEVELS_REACHED_HEADING}
          </h3>
          <ol
            aria-labelledby="member-progression-milestones"
            className="m-0 flex list-none flex-col gap-2 p-0"
          >
            {summary.milestones.map((milestone) => {
              const reached = formatChicagoReachedDate(milestone.reachedAt);
              const marker = drawingEntryMarker(milestone);
              return (
                <li
                  key={milestone.level}
                  data-level={milestone.level}
                  data-quarter-key={milestone.quarterKey}
                  className="flex min-w-0 flex-col gap-1 break-words rounded-2xl border border-wb-line bg-white px-4 py-3"
                >
                  <span className="text-sm font-semibold text-wb-ink">
                    Level {milestone.level} · {milestone.name}
                  </span>
                  <span className="text-xs text-wb-muted">Reached {reached ?? '—'}</span>
                  <span className="text-xs text-wb-muted">{formatQuarterLabel(milestone.quarterKey)}</span>
                  {marker ? <span className="text-xs font-semibold text-wb-ink">{marker}</span> : null}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-2">
        <h3 id="member-progression-entries" className="m-0 text-base font-semibold text-wb-ink">
          {DRAWING_ENTRIES_HEADING}
        </h3>
        {summary.entriesByQuarter.length === 0 ? (
          <p className="m-0 text-sm text-wb-muted">{NO_DRAWING_ENTRIES_YET}</p>
        ) : (
          <ul
            aria-labelledby="member-progression-entries"
            className="m-0 flex list-none flex-col gap-2 p-0"
          >
            {summary.entriesByQuarter.map((row) => (
              <li
                key={row.quarterKey}
                data-quarter-key={row.quarterKey}
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-wb-ink"
              >
                <span className="break-words">{formatQuarterLabel(row.quarterKey)}</span>
                <span className="font-semibold">{pluralize(row.count, 'drawing entry', 'drawing entries')}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 text-xs leading-snug text-wb-muted">{DRAWING_ENTRIES_NOTE}</p>
      </div>

      {sampleDrawing ? <SampleDrawingCard drawing={sampleDrawing} /> : null}
    </section>
  );
}

export function MemberProgressionUnavailable() {
  return (
    <section aria-labelledby="member-progression-heading" className="flex min-w-0 flex-col gap-3">
      <h2
        id="member-progression-heading"
        className="wb-display m-0 text-[30px] leading-tight text-wb-ink"
      >
        {MEMBER_PROGRESSION_HEADING}
      </h2>
      <p role="status" className="m-0 text-sm text-wb-ink">
        {PROGRESSION_UNAVAILABLE_MESSAGE}
      </p>
    </section>
  );
}
