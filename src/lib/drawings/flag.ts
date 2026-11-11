/** Exact string only. Unset, empty, and every other value stay off. */
export const DRAWINGS_ADMIN_FLAG = 'E09_DRAWINGS_ADMIN_ENABLED';

export function drawingsAdminEnabled(
  value: string | undefined = process.env.E09_DRAWINGS_ADMIN_ENABLED,
): boolean {
  return value === 'true';
}
