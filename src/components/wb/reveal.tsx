"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type RevealProps = {
  children: ReactNode;
  className?: string;
};

function reducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Fade and a 12px rise the first time this block enters the view.
 * Hidden styles apply only after mount, so server HTML and no-JS
 * browsers keep the content visible. Reduced motion never subscribes,
 * so the block stays in that visible server state with no transition.
 */
export function Reveal({ children, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"pending" | "hidden" | "shown">("pending");

  useEffect(() => {
    const node = ref.current;
    if (!node || reducedMotion()) return;

    let revealed = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (revealed) return;
        const visible = entries.some((entry) => entry.isIntersecting);
        if (!visible) {
          setPhase("hidden");
          return;
        }
        revealed = true;
        setPhase("shown");
        observer.disconnect();
      },
      { threshold: 0.15 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-reveal={phase}
      className={cn(
        phase === "hidden" && "translate-y-[12px] opacity-0",
        phase === "shown" &&
          "translate-y-0 opacity-100 transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
