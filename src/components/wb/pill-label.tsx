import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PillLabelProps = {
  children: ReactNode;
  /** Degrees. Spec uses about −2° to −3°. Pass 0 to keep it level. */
  tilt?: number;
  className?: string;
};

export function PillLabel({ children, tilt = -2, className }: PillLabelProps) {
  return (
    <span className={cn("wb-pill-label", className)} style={{ transform: `rotate(${tilt}deg)` }}>
      {children}
    </span>
  );
}
