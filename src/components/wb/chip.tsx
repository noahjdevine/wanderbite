import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ChipProps = {
  variant?: "glass" | "tinted" | "matched" | "unknown";
  children: ReactNode;
  className?: string;
};

function Check() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function Chip({ variant = "glass", children, className }: ChipProps) {
  const look =
    variant === "matched"
      ? "wb-chip-matched"
      : variant === "unknown"
        ? "wb-chip-unknown"
        : variant === "tinted"
          ? "wb-chip-tinted"
          : "wb-chip-glass";
  return (
    <span className={cn(look, className)}>
      {variant === "matched" ? <Check /> : null}
      {children}
    </span>
  );
}
