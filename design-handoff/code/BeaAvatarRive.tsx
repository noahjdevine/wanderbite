"use client";
/**
 * BeaAvatarRive — the Rive version of Bea. Same props as BeaAvatar.
 * Expects /public/bea.riv built to RIVE_BRIEF.md:
 *   artboard "Bea", state machine "Bea",
 *   Number input "state" (0 idle, 1 thinking, 2 found),
 *   Number input "food"  (0 dumpling, 1 sushi, 2 pizza, 3 taco, 4 burger, 5 bbq)
 *
 * Install: npm i @rive-app/react-canvas
 * Don't import this directly; use <Bea /> from Bea.tsx, which decides SVG vs Rive.
 */
import { useEffect } from "react";
import { useRive, useStateMachineInput, Layout, Fit, Alignment } from "@rive-app/react-canvas";
import type { BeaFood, BeaState } from "./BeaAvatar";

const STATE_MACHINE = "Bea";

const STATE_VALUE: Record<BeaState, number> = { idle: 0, thinking: 1, found: 2 };
const FOOD_VALUE: Record<BeaFood, number> = {
  generic: 0,
  dumpling: 0,
  sushi: 1,
  pizza: 2,
  taco: 3,
  burger: 4,
  bbq: 5,
};

type Props = {
  state?: BeaState;
  food?: BeaFood | null;
  size?: number;
  label?: string;
  className?: string;
  src?: string;
};

export default function BeaAvatarRive({
  state = "idle",
  food = null,
  size = 160,
  label,
  className,
  src = "/bea.riv",
}: Props) {
  const { rive, RiveComponent } = useRive({
    src,
    artboard: "Bea",
    stateMachines: STATE_MACHINE,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  });

  const stateInput = useStateMachineInput(rive, STATE_MACHINE, "state");
  const foodInput = useStateMachineInput(rive, STATE_MACHINE, "food");

  useEffect(() => {
    if (stateInput) stateInput.value = STATE_VALUE[state];
  }, [stateInput, state]);

  useEffect(() => {
    if (foodInput) foodInput.value = FOOD_VALUE[food ?? "generic"];
  }, [foodInput, food]);

  const aria =
    label ??
    (state === "thinking"
      ? "Bea is thinking"
      : state === "found"
        ? "Bea found a pick for you"
        : "Bea, your Wanderbite concierge");

  return (
    <div role="img" aria-label={aria} className={className} style={{ width: size, height: size }}>
      <RiveComponent aria-hidden="true" />
    </div>
  );
}
