/** Exact string only. Unset, empty, and every other value stay off. */
export const DRAWINGS_ADMIN_FLAG = 'E09_DRAWINGS_ADMIN_ENABLED';

/** Exact string only, and only together with the read flag. Ships unset. */
export const DRAWINGS_ADMIN_ACTIONS_FLAG = 'E09_DRAWINGS_ADMIN_ACTIONS_ENABLED';

export function drawingsAdminEnabled(
  value: string | undefined = process.env.E09_DRAWINGS_ADMIN_ENABLED,
): boolean {
  return value === 'true';
}

/**
 * Admin activate, close, and simulated selection.
 * True only when this flag is exactly "true" and the read flag is also on.
 */
export function drawingsAdminActionsEnabled(
  actionsValue: string | undefined = process.env.E09_DRAWINGS_ADMIN_ACTIONS_ENABLED,
  adminValue: string | undefined = process.env.E09_DRAWINGS_ADMIN_ENABLED,
): boolean {
  return actionsValue === 'true' && drawingsAdminEnabled(adminValue);
}

/** Exact string only, and only together with the read flag and the campaign-action flag. Ships unset. */
export const DRAWINGS_FULFILLMENT_ACTIONS_FLAG = 'E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED';

/**
 * Admin create and move of sample fulfillment records.
 * True only when this flag is exactly "true" and both drawing flags are also on.
 */
export function drawingsFulfillmentActionsEnabled(
  fulfillmentValue: string | undefined = process.env.E09_DRAWINGS_FULFILLMENT_ACTIONS_ENABLED,
  actionsValue: string | undefined = process.env.E09_DRAWINGS_ADMIN_ACTIONS_ENABLED,
  adminValue: string | undefined = process.env.E09_DRAWINGS_ADMIN_ENABLED,
): boolean {
  return fulfillmentValue === 'true' && drawingsAdminActionsEnabled(actionsValue, adminValue);
}
