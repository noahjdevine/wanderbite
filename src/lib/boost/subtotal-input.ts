/** Dollars typed by staff, such as 55 or 55.00. Same rules as arrival check-in. */

/** Neutral example. A real-looking amount belongs in the field only after staff type it. */
export const ELIGIBLE_SUBTOTAL_PLACEHOLDER = 'e.g. 55.00';

/** Eligible cents are food and drink. Tax and tip are not part of that subtotal. */
export const ELIGIBLE_SUBTOTAL_HELP = 'Food and drink before tax and tip.';

export const ELIGIBLE_SUBTOTAL_INVALID =
  'Enter the eligible subtotal in dollars, such as 55.00.';

export function parseEligibleSubtotalDollars(raw: string): number | null {
  const text = raw.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  if (!whole || whole.length > 7) return null;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}
