import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type GlowBorderProps = {
  radius?: number;
  /** Seconds for one full rotation. Spec is 6–7s. */
  speed?: number;
  baseColor?: "dark" | "cream";
  className?: string;
  children: ReactNode;
};

export function GlowBorder({
  radius = 26,
  speed = 6.5,
  baseColor = "dark",
  className,
  children,
}: GlowBorderProps) {
  return (
    <div
      className={cn("wb-glow", baseColor === "cream" && "wb-glow--cream", className)}
      style={{ borderRadius: radius, ["--wb-glow-speed" as string]: `${speed}s` }}
    >
      <div className="wb-glow__inner" style={{ borderRadius: Math.max(0, radius - 1.5) }}>
        {children}
      </div>
    </div>
  );
}
