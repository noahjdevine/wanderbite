import {
  ABOUT_BRIEFING_FIELD,
  FIRST_VISIT_HEADING,
  briefingBodyMaxChars,
  formatBriefingChecked,
  isMemberBriefingField,
  type BriefingFact,
} from '@/lib/briefings/types';

function visibleText(fact: BriefingFact): string | null {
  const text = fact.text.trim();
  if (!text || text.length > briefingBodyMaxChars(fact.field)) return null;
  return text;
}

type FirstVisitBriefingProps = {
  headingId: string;
  facts: readonly BriefingFact[];
};

export function FirstVisitBriefing({ headingId, facts }: FirstVisitBriefingProps) {
  const about = facts.find((fact) => fact.field === ABOUT_BRIEFING_FIELD);
  const aboutText = about ? visibleText(about) : null;
  if (about && aboutText) {
    return (
      <section className="space-y-2" aria-labelledby={headingId}>
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          {FIRST_VISIT_HEADING}
        </h3>
        <p className="text-sm text-foreground">{aboutText}</p>
        {about.sampleLabel ? (
          <p className="text-xs font-medium text-foreground">{about.sampleLabel}</p>
        ) : null}
      </section>
    );
  }
  const visible = facts.filter((fact) => isMemberBriefingField(fact.field) && visibleText(fact));
  if (visible.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        {FIRST_VISIT_HEADING}
      </h3>
      <ul className="space-y-2">
        {visible.map((fact) => {
          const checked = formatBriefingChecked(fact.lastVerifiedAt);
          if (!checked) return null;
          return (
            <li key={fact.field} className="min-w-0 space-y-1 rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">{fact.label}</p>
              <p className="text-xs text-muted-foreground">{visibleText(fact)}</p>
              {fact.sampleLabel ? (
                <p className="text-xs font-medium text-foreground">{fact.sampleLabel}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">Checked {checked}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
