export const PARTNER_PIN_MIN_DIGITS = 4;
export const PARTNER_PIN_MAX_DIGITS = 6;
export const PARTNER_PIN_PATTERN = `\\d{${PARTNER_PIN_MIN_DIGITS},${PARTNER_PIN_MAX_DIGITS}}`;
export const PARTNER_PIN_VALIDATION_MESSAGE = 'Enter a 4–6 digit PIN.';
export const PARTNER_LOGIN_VALIDATION_MESSAGE =
  'Select a restaurant and enter a 4–6 digit PIN.';
export const PARTNER_LOGIN_UNAVAILABLE_MESSAGE =
  'Unable to sign in right now. Please try again later.';

const PIN_RE = /^\d{4,6}$/;

/** Keep the digit string, including leading zeros such as 0042. */
export function parsePartnerPin(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const pin = raw.trim();
  return PIN_RE.test(pin) ? pin : null;
}

export function filterPartnerPinInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, PARTNER_PIN_MAX_DIGITS);
}

export function isPartnerLoginDisabled(
  value: string | undefined = process.env.WANDERBITE_PARTNER_LOGIN_DISABLED,
): boolean {
  return value === 'true';
}
