export const REDEMPTION_ISSUE_UNAVAILABLE_MESSAGE =
  'Unable to issue a redemption code right now. Please try again later.';

export function isRedemptionIssuanceDisabled(
  value: string | undefined = process.env.WANDERBITE_REDEMPTION_ISSUANCE_DISABLED,
): boolean {
  return value === 'true';
}
