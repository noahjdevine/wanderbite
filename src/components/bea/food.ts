/** 0–5 matches the Rive brief. Names match BEA_AI_SPEC's pick event. */
export const BEA_FOOD_INDEX = {
  dumpling: 0,
  nigiri: 1,
  pizza: 2,
  taco: 3,
  burger: 4,
  bbq: 5,
} as const;

export type BeaFoodIndex = 0 | 1 | 2 | 3 | 4 | 5;

export type BeaFoodName =
  | "dumpling"
  | "nigiri"
  | "sushi"
  | "pizza"
  | "taco"
  | "burger"
  | "bbq"
  | "generic";

export type BeaFood = BeaFoodIndex | BeaFoodName;

export type ResolvedBeaFood = {
  index: BeaFoodIndex;
  label: string;
};

const LABELS: Record<BeaFoodIndex, string> = {
  0: "dumpling",
  1: "nigiri",
  2: "pizza",
  3: "taco",
  4: "burger",
  5: "BBQ",
};

export function resolveBeaFood(food: BeaFood | null | undefined): ResolvedBeaFood {
  if (food === null || food === undefined || food === "generic" || food === "dumpling" || food === 0) {
    return { index: 0, label: LABELS[0] };
  }
  if (food === "sushi" || food === "nigiri" || food === 1) {
    return { index: 1, label: LABELS[1] };
  }
  if (food === "pizza" || food === 2) return { index: 2, label: LABELS[2] };
  if (food === "taco" || food === 3) return { index: 3, label: LABELS[3] };
  if (food === "burger" || food === 4) return { index: 4, label: LABELS[4] };
  if (food === "bbq" || food === 5) return { index: 5, label: LABELS[5] };
  return { index: 0, label: LABELS[0] };
}
