export function isWanderbiteAiDisabled(
  value: string | undefined = process.env.WANDERBITE_AI_DISABLED,
): boolean {
  return value === 'true';
}
