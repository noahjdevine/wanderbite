"use client";
/**
 * <Bea /> — the ONE component the app should use for the AI concierge avatar.
 *
 * - Today: renders the SVG placeholder (BeaAvatar).
 * - When bea.riv arrives: set NEXT_PUBLIC_BEA_RIVE=1 and put the file at /public/bea.riv.
 *   Sizes >= 48px then render the Rive version; small sizes stay SVG face-only.
 * - Users with "reduce motion" always get the SVG (which disables its own animation).
 *
 * Swapping to Rive requires NO changes anywhere else in the app.
 */
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { BeaAvatar, type BeaFood, type BeaState } from "./BeaAvatar";

const BeaAvatarRive = dynamic(() => import("./BeaAvatarRive"), {
  ssr: false,
});

export type BeaProps = {
  state?: BeaState;
  food?: BeaFood | null;
  size?: number;
  label?: string;
  className?: string;
};

const RIVE_ENABLED = process.env.NEXT_PUBLIC_BEA_RIVE === "1";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function Bea(props: BeaProps) {
  const reduced = usePrefersReducedMotion();
  const size = props.size ?? 120;
  const useRiveVersion = RIVE_ENABLED && !reduced && size >= 48;

  if (useRiveVersion) return <BeaAvatarRive {...props} size={size} />;
  return <BeaAvatar {...props} size={size} />;
}

export default Bea;
