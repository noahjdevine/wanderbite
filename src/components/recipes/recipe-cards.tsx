'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { setSavedRecipe } from '@/app/actions/save-recipe';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  RECIPES_SECTION_HEADING,
  SAVED_RECIPES_HEADING,
  type RecipeCardModel,
} from '@/lib/recipes/display';

type RecipeCardsProps = {
  headingId: string;
  heading: typeof RECIPES_SECTION_HEADING | typeof SAVED_RECIPES_HEADING;
  description?: string;
  exclusionLine: string | null;
  recipes: RecipeCardModel[];
  emptyLabel?: string;
  showHeading?: boolean;
};

function RecipeCard({ recipe }: { recipe: RecipeCardModel }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const sourceHref = recipe.sourceUrl?.startsWith('https://') ? recipe.sourceUrl : null;

  async function toggleSaved() {
    setPending(true);
    try {
      const result = await setSavedRecipe(recipe.id, !recipe.saved);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(recipe.saved ? 'Recipe removed' : 'Recipe saved');
      router.refresh();
    } catch {
      toast.error('Recipe could not be saved.');
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="space-y-3 rounded-lg border border-border p-3" data-recipe-type={recipe.recipeType}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{recipe.typeLabel}</Badge>
        {recipe.demoLabel ? <Badge variant="outline">{recipe.demoLabel}</Badge> : null}
      </div>
      <h4 className="text-sm font-semibold text-foreground">{recipe.title}</h4>
      <p className="text-xs text-muted-foreground">
        Serves {recipe.servings} · {recipe.estMinutes} min
      </p>
      {recipe.uncertaintyLine ? (
        <p className="text-xs text-muted-foreground">{recipe.uncertaintyLine}</p>
      ) : null}
      {recipe.description ? (
        <p className="text-xs text-muted-foreground">{recipe.description}</p>
      ) : null}
      {recipe.provenanceLabel ? (
        <p className="text-xs text-muted-foreground">{recipe.provenanceLabel}</p>
      ) : null}
      {recipe.retrievedAtLabel ? (
        <p className="text-xs text-muted-foreground">Menu retrieved {recipe.retrievedAtLabel}</p>
      ) : null}
      {recipe.paraphraseLine ? (
        <p className="text-xs text-muted-foreground">{recipe.paraphraseLine}</p>
      ) : null}
      {recipe.dietaryWarning ? (
        <p className="text-xs text-foreground" role="note">
          {recipe.dietaryWarning}
        </p>
      ) : null}
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">Ingredients</p>
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
          {recipe.ingredients.map((ingredient) => (
            <li key={`${ingredient.name}-${ingredient.quantity}-${ingredient.unit}`}>
              {ingredient.quantity} {ingredient.unit} {ingredient.name}
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">Steps</p>
        <ol className="list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
          {recipe.steps.map((step) => (
            <li key={step.order}>{step.text}</li>
          ))}
        </ol>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-foreground">Substitutions</p>
        {recipe.substitutions.length === 0 ? (
          <p className="text-xs text-muted-foreground">None listed.</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {recipe.substitutions.map((substitution) => (
              <li key={`${substitution.insteadOf}-${substitution.use}`}>
                {substitution.use} instead of {substitution.insteadOf}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {recipe.typeLabel}
        {sourceHref ? (
          <>
            {' '}
            ·{' '}
            <a
              href={sourceHref}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {recipe.sourceName ?? 'Source'}
            </a>
          </>
        ) : recipe.sourceName ? (
          <> · {recipe.sourceName}</>
        ) : null}
      </p>
      <p className="text-xs text-muted-foreground">Checked {recipe.checkedAtLabel}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          void toggleSaved();
        }}
      >
        {pending ? 'Saving…' : recipe.saved ? 'Unsave recipe' : 'Save recipe'}
      </Button>
    </article>
  );
}

export function RecipeCards({
  headingId,
  heading,
  description,
  exclusionLine,
  recipes,
  emptyLabel,
  showHeading = true,
}: RecipeCardsProps) {
  if (recipes.length === 0 && !emptyLabel) return null;

  return (
    <section
      className="space-y-3"
      aria-labelledby={showHeading ? headingId : undefined}
      aria-label={showHeading ? undefined : heading}
    >
      <div className="space-y-1">
        {showHeading ? (
          <h3 id={headingId} className="text-sm font-semibold">
            {heading}
          </h3>
        ) : null}
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        {exclusionLine ? <p className="text-xs text-muted-foreground">{exclusionLine}</p> : null}
      </div>
      {recipes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </section>
  );
}
