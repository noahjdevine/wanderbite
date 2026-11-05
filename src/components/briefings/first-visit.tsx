import { FIRST_VISIT_HEADING, formatBriefingChecked, type BriefingFact } from '@/lib/briefings/types';

type FirstVisitBriefingProps = {
  headingId: string;
  facts: readonly BriefingFact[];
};

export function FirstVisitBriefing({ headingId, facts }: FirstVisitBriefingProps) {
  if (facts.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        {FIRST_VISIT_HEADING}
      </h3>
      <ul className="space-y-2">
        {facts.map((fact) => {
          const checked = formatBriefingChecked(fact.lastVerifiedAt);
          if (!checked) return null;
          return (
            <li key={fact.field} className="space-y-1 rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">{fact.label}</p>
              <p className="text-xs text-muted-foreground">{fact.text}</p>
              {fact.sampleLabel ? (
                <p className="text-xs font-medium text-foreground">{fact.sampleLabel}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">Checked {checked}</p>
              <a
                href={fact.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-primary underline"
              >
                Source
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
