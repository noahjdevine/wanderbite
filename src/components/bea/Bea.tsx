/**
 * The only avatar the app should render.
 *
 * Rive is intentionally not wired: no @rive-app dependency and no .riv file.
 * design-handoff/code/BeaAvatarRive.tsx stays in the handoff pack for reference.
 * Reduced motion and sizes under 48px are handled in the SVG stylesheet.
 */
import { BeaAvatar, type BeaState } from "./BeaAvatar";
import type { BeaFood } from "./food";

export type { BeaFood, BeaFoodIndex, BeaFoodName } from "./food";
export type { BeaState } from "./BeaAvatar";
export { BEA_DISPLAY_NAME } from "./name";

export type BeaProps = {
  state?: BeaState;
  /** 0 dumpling, 1 nigiri, 2 pizza, 3 taco, 4 burger, 5 BBQ. Names from BEA_AI_SPEC are accepted too. */
  food?: BeaFood | null;
  /** Rendered width in px. Below 48 the face is shown alone. */
  size?: number;
  label?: string;
  className?: string;
};

export function Bea({ state = "idle", food = 0, size = 120, label, className }: BeaProps) {
  return <BeaAvatar state={state} food={food} size={size} label={label} className={className} />;
}

export default Bea;
