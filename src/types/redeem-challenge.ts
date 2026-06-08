/** Result type for `redeemChallengeItem` — kept out of `use server` modules. */

export type RedeemChallengeResult =
  | { ok: true; data: { token: string; redeemedAt: string; redemptionId: string } }
  | { ok: false; error: string };
