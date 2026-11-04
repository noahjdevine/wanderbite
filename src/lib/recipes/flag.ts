/** Exact string only. Unset, empty, and every other value stay off. */
export const RECIPES_FLAG = 'E05_RECIPES_ENABLED';

/** Exact string only. Also requires `E05_RECIPES_ENABLED=true`. */
export const RECIPE_QA_FLAG = 'E05_RECIPE_QA_ENABLED';

const UNAVAILABLE_LOG = '[recipes] unavailable';
const READ_FAILED_LOG = '[recipes] read failed';
const SAVE_FAILED_LOG = '[recipes] save failed';

let unavailableLogged = false;
let readFailedLogged = false;
let saveFailedLogged = false;

export function recipesEnabled(
  value: string | undefined = process.env.E05_RECIPES_ENABLED,
): boolean {
  return value === 'true';
}

export function recipeQaEnabled(
  qaValue: string | undefined = process.env.E05_RECIPE_QA_ENABLED,
  recipesValue: string | undefined = process.env.E05_RECIPES_ENABLED,
): boolean {
  return qaValue === 'true' && recipesEnabled(recipesValue);
}

export function recipeSchemaMissing(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  if (code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205') {
    return true;
  }
  const message = error.message ?? '';
  return (
    message.includes('does not exist') ||
    message.includes('Could not find the function') ||
    message.includes('Could not find the table') ||
    message.includes('schema cache')
  );
}

export function logRecipesUnavailableOnce(): void {
  if (unavailableLogged) return;
  unavailableLogged = true;
  console.warn(UNAVAILABLE_LOG);
}

export function logRecipesReadFailedOnce(): void {
  if (readFailedLogged) return;
  readFailedLogged = true;
  console.warn(READ_FAILED_LOG);
}

export function logRecipesSaveFailedOnce(): void {
  if (saveFailedLogged) return;
  saveFailedLogged = true;
  console.warn(SAVE_FAILED_LOG);
}

export function resetRecipesLogs(): void {
  unavailableLogged = false;
  readFailedLogged = false;
  saveFailedLogged = false;
}
