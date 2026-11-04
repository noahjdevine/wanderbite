import { descriptionFactValue, type DescriptionFact, type DescriptionFactValue } from '@/lib/content-pipeline/facts';

export type FactRollback = {
  supersedeId: string;
  version: number;
  value: DescriptionFactValue;
  evidenceExcerpt: string;
  subjectId: string;
  sourceId: string;
};

export type RecipeRollback = FactRollback & {
  recipeVersion: number;
  description: string;
};

function series(facts: readonly DescriptionFact[], current: DescriptionFact): DescriptionFact[] {
  return facts
    .filter((fact) => fact.sourceId === current.sourceId && fact.subjectId === current.subjectId)
    .sort((a, b) => a.version - b.version);
}

function currentFact(facts: readonly DescriptionFact[], factId: string): DescriptionFact | null {
  const named = facts.find((fact) => fact.id === factId);
  if (!named) return null;
  if (named.status === 'current') return named;
  const current = series(facts, named)
    .filter((fact) => fact.status === 'current')
    .at(-1);
  return current ?? null;
}

export function planFactRollback(facts: readonly DescriptionFact[], factId: string): FactRollback | { error: string } {
  const named = facts.find((fact) => fact.id === factId);
  if (named) return { error: 'use rollback_recipe_to_previous' };
  const current = currentFact(facts, factId);
  if (!current) return { error: 'no current fact' };
  const previous = series(facts, current)
    .filter((fact) => fact.version < current.version)
    .at(-1);
  if (!previous) return { error: 'no previous fact version' };
  const version = Math.max(...series(facts, current).map((fact) => fact.version)) + 1;
  return {
    supersedeId: current.id,
    version,
    value: descriptionFactValue(previous),
    evidenceExcerpt: previous.evidenceExcerpt,
    subjectId: current.subjectId,
    sourceId: current.sourceId,
  };
}

export function planRecipeRollback(
  facts: readonly DescriptionFact[],
  factId: string,
  recipeVersion: number,
): RecipeRollback | { error: string } {
  const current = currentFact(facts, factId);
  if (!current) return { error: 'no current fact' };
  if (current.version !== recipeVersion) return { error: 'description fact version does not match recipe version' };
  const previous = series(facts, current)
    .filter((fact) => fact.version < current.version)
    .at(-1);
  if (!previous) return { error: 'no previous fact version' };
  const description = previous.text.trim();
  if (!description || description.length > 400) return { error: 'previous description is not restorable' };
  return {
    supersedeId: current.id,
    version: recipeVersion + 1,
    value: descriptionFactValue(previous),
    evidenceExcerpt: previous.evidenceExcerpt,
    subjectId: current.subjectId,
    sourceId: current.sourceId,
    recipeVersion: recipeVersion + 1,
    description,
  };
}

/** The saved row keeps its recipe_version. That version still names a stored fact. */
export function resolveSavedDescription(facts: readonly DescriptionFact[], savedVersion: number): string | null {
  const match = facts.find((fact) => fact.version === savedVersion);
  return match?.text ?? null;
}
