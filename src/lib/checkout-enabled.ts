/**
 * Paid Checkout is fail-closed. Only the exact string "true" enables it.
 * Missing, empty, "1", "TRUE", or any other value keeps Checkout off.
 */
export function isCheckoutEnabled(
  value: string | undefined = process.env.CHECKOUT_ENABLED
): boolean {
  return value === 'true';
}

export const CHECKOUT_UNAVAILABLE_MESSAGE = 'Checkout is unavailable.';
