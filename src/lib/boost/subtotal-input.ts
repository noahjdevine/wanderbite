/** Dollars typed by staff, such as 82 or 82.00. Same rules as arrival check-in. */
export function parseEligibleSubtotalDollars(raw: string): number | null {
  const text = raw.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  if (!whole || whole.length > 7) return null;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}
