/** Result type for `redeemChallengeItem` — kept out of `use server` modules. */

export type RedeemChallengeResult =
  | { ok: true; data: { token: string; redeemedAt: string } }
  | { ok: false; error: string };
