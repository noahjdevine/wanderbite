import type { ReactNode } from "react";
import { CtaButton } from "./cta-button";
import { StatusTrack, type StatusTrackStatus } from "./status-track";

type ChallengeTicketProps = {
  name: string;
  area: string;
  offerAmount: string;
  offerRequirement: string;
  status: StatusTrackStatus;
  actionHref: string;
  actionLabel: string;
  actionVariant?: "primary" | "secondary-cream";
  actionCreamStyle?: "outline" | "plum";
  photoLabel: string;
  photoCredit?: string;
  badge?: string;
  note?: ReactNode;
  photoHeight?: number;
};

export function ChallengeTicket({
  name,
  area,
  offerAmount,
  offerRequirement,
  status,
  actionHref,
  actionLabel,
  actionVariant = "primary",
  actionCreamStyle = "plum",
  photoLabel,
  photoCredit,
  badge,
  note,
  photoHeight = 200,
}: ChallengeTicketProps) {
  return (
    <article className="wb-card relative" aria-label={name}>
      <div className="relative overflow-hidden rounded-t-[26px]" style={{ height: photoHeight }}>
        <div
          aria-hidden="true"
          className="absolute inset-[-6%] wb-drift"
          style={{
            background:
              "radial-gradient(circle at 35% 40%, rgba(253,186,116,0.8) 0%, rgba(253,186,116,0) 38%), radial-gradient(circle at 75% 65%, rgba(244,114,182,0.55) 0%, rgba(244,114,182,0) 42%), linear-gradient(155deg, #6b3a2a 0%, #3a1d4f 60%, #1d1033 100%)",
          }}
        />
        {badge ? (
          <span
            className="absolute left-3 top-3 inline-flex items-center rounded-full px-2.5 py-1.5 text-xs font-bold"
            style={{ color: "var(--wb-photo-wait-fg)", background: "var(--wb-photo-wait-bg)" }}
          >
            {badge}
          </span>
        ) : null}
        <span className="absolute bottom-3 right-3 rounded-full border border-dashed border-white/45 px-2 py-1 text-[10px] font-semibold tracking-wide text-white/85">
          {photoLabel}
        </span>
        {photoCredit ? (
          <span className="absolute bottom-3 left-3 text-[11px] text-white/85">{photoCredit}</span>
        ) : null}
      </div>
      <div aria-hidden="true" className="relative h-0">
        <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-wb-cream" />
        <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-wb-cream" />
      </div>
      <div className="flex flex-col gap-3.5 px-5 py-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-display m-0 text-[36px] leading-none font-normal text-wb-ink">{name}</h3>
          <span className="text-sm text-wb-muted">{area}</span>
        </div>
        <div className="flex items-center justify-between rounded-2xl border-[1.5px] border-dashed border-[#e3d9c6] bg-[#f4efe6] px-3.5 py-3">
          <span className="font-display text-[26px] leading-none text-wb-plum">{offerAmount}</span>
          <span className="text-[13px] text-wb-muted">{offerRequirement}</span>
        </div>
        <StatusTrack status={status} />
        <CtaButton href={actionHref} variant={actionVariant} creamStyle={actionCreamStyle} className="min-h-[52px] w-full">
          {actionLabel}
        </CtaButton>
        {note ? <p className="m-0 text-center text-xs text-wb-muted">{note}</p> : null}
      </div>
    </article>
  );
}
