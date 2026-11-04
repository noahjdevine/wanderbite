import { RecipeCards } from '@/components/recipes/recipe-cards';
import {
  GENERATED_HOME_RECIPE_LABEL,
  RECIPE_QA_CARDS_HEADING,
  type RecipeCardModel,
} from '@/lib/recipes/display';

export type RecipeQaAnswerView = {
  answer: string;
  notice: string | null;
  recipes: RecipeCardModel[];
  generatedLabel: string | null;
  generatedText: string | null;
  visitLines: string[];
};

export function RecipeQaAnswer({ qa }: { qa: RecipeQaAnswerView }) {
  const generated =
    qa.generatedLabel === GENERATED_HOME_RECIPE_LABEL && qa.generatedText
      ? qa.generatedText
      : null;

  return (
    <div className="space-y-6 text-left" data-recipe-qa="true">
      {qa.notice ? (
        <p className="text-sm text-muted-foreground" role="status">
          {qa.notice}
        </p>
      ) : null}
      <p className="text-sm leading-relaxed text-foreground">{qa.answer}</p>
      {qa.visitLines.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
          {qa.visitLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {qa.recipes.length > 0 ? (
        <RecipeCards
          headingId="recipe-qa-cards"
          heading={RECIPE_QA_CARDS_HEADING}
          recipes={qa.recipes}
          exclusionLine={null}
        />
      ) : null}
      {generated ? (
        <article className="space-y-2 rounded-lg border border-dashed border-border p-3">
          <p className="text-xs font-medium text-foreground">{GENERATED_HOME_RECIPE_LABEL}</p>
          <p className="text-xs text-muted-foreground">{generated}</p>
        </article>
      ) : null}
    </div>
  );
}
