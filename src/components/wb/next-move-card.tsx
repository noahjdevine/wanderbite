import type { ReactNode } from "react";
import { GlowBorder } from "./glow-border";
import { CtaButton } from "./cta-button";
import { Bea } from "@/components/bea/Bea";

type NextMoveCardProps = {
  sentence: ReactNode;
  meta: string;
  actionHref: string;
  actionLabel: string;
};

export function NextMoveCard({ sentence, meta, actionHref, actionLabel }: NextMoveCardProps) {
  return (
    <GlowBorder baseColor="cream" radius={26} speed={7}>
      <div className="flex flex-col gap-3.5 p-[18px]">
        <div className="flex items-center gap-2.5">
          <Bea size={28} />
          <h2 className="m-0 text-[13px] font-bold tracking-[1.2px] text-wb-muted">YOUR NEXT MOVE</h2>
        </div>
        <p className="font-display m-0 text-[30px] leading-[1.05] text-wb-ink">{sentence}</p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-wb-muted">{meta}</span>
          <CtaButton href={actionHref} className="min-h-11 px-[18px] text-sm">
            {actionLabel}
          </CtaButton>
        </div>
      </div>
    </GlowBorder>
  );
}
