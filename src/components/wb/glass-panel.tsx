import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type GlassPanelProps = {
  variant?: "light-on-dark" | "dark-card";
  radius?: number;
  padding?: number;
  className?: string;
  children: ReactNode;
};

export function GlassPanel({
  variant = "light-on-dark",
  radius = 26,
  padding = 20,
  className,
  children,
}: GlassPanelProps) {
  return (
    <div
      className={cn(variant === "dark-card" ? "wb-glass-card" : "wb-glass", className)}
      style={{ borderRadius: radius, padding }}
    >
      {children}
    </div>
  );
}
