import { splitNoteByNames } from '@/lib/activities/note-segments';
import { ACTIVITY_NOTE_HEADING } from '@/lib/activities/types';

type ActivityNoteBlockProps = {
  headingId: string;
  body: string | null;
  /** Official names, short names, and the restaurant name. Matched as text, not HTML. */
  names?: readonly string[];
};

/** Warm personal note. No link, price, or hours line. Empty body renders nothing. */
export function ActivityNoteBlock({ headingId, body, names = [] }: ActivityNoteBlockProps) {
  const text = body?.trim() ?? '';
  if (!text) return null;
  const segments = splitNoteByNames(text, names);
  return (
    <section
      aria-labelledby={headingId}
      data-activity-note=""
      className="scroll-mb-28 rounded-2xl border border-[#e3d9c6] bg-[#f4efe6] px-4 py-3"
    >
      <h3 id={headingId} className="mb-1 font-display text-base text-wb-plum">
        {ACTIVITY_NOTE_HEADING}
      </h3>
      <p className="m-0 text-sm leading-relaxed text-wb-ink">
        {segments.map((segment, index) =>
          segment.isName ? (
            <em key={index} className="italic">
              {segment.text}
            </em>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </p>
    </section>
  );
}
