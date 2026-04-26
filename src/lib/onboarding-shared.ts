/** Onboarding constants and types — kept out of `use server` modules. */

export const DISTANCE_BANDS = ['5_mi', '15_mi', '25_mi', '40_mi'] as const;
export type DistanceBand = (typeof DISTANCE_BANDS)[number];

export type OnboardingData = {
  dietary_flags: string[];
  distance_band: string;
  wants_cocktail_experience?: boolean;
};

export type CompleteOnboardingResult =
  | { ok: true }
  | { ok: false; error: string };
