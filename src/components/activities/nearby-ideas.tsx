import {
  NEARBY_IDEA_HEADING,
  OPTIONAL_ACTIVITY_LABEL,
  type ActivitySuggestion,
} from '@/lib/activities/types';

type NearbyIdeasProps = {
  headingId: string;
  suggestions: readonly ActivitySuggestion[];
};

export function NearbyIdeas({ headingId, suggestions }: NearbyIdeasProps) {
  if (suggestions.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        {NEARBY_IDEA_HEADING}
      </h3>
      <p className="text-xs text-muted-foreground">{OPTIONAL_ACTIVITY_LABEL}</p>
      <ul className="space-y-2">
        {suggestions.map((suggestion) => (
          <li key={suggestion.id} className="space-y-1 rounded-lg border border-border p-3">
            <p className="text-sm font-medium text-foreground">{suggestion.name}</p>
            <p className="text-xs text-muted-foreground">{suggestion.categoryLabel}</p>
            {suggestion.durationLabel ? (
              <p className="text-xs text-muted-foreground">{suggestion.durationLabel}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">{suggestion.costLabel}</p>
            <p className="text-xs text-muted-foreground">{suggestion.hoursLabel}</p>
            {suggestion.weatherLabel ? (
              <p className="text-xs text-muted-foreground">{suggestion.weatherLabel}</p>
            ) : null}
            {suggestion.bookingLabel ? (
              <p className="text-xs text-muted-foreground">{suggestion.bookingLabel}</p>
            ) : null}
            {suggestion.sampleLabel ? (
              <p className="text-xs font-medium text-foreground">{suggestion.sampleLabel}</p>
            ) : null}
            <a
              href={suggestion.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-primary underline"
            >
              Official site
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
