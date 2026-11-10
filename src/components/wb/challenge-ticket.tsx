import type { ReactNode } from "react";
import { CtaButton } from "./cta-button";
import { StatusTrack, type StatusTrackStatus } from "./status-track";

type ChallengeTicketProps = {
  name: string;
  area: string;
  /** Omitted on the directory, which does not show an offer. */
  offerAmount?: string;
  offerRequirement?: string;
  /** Short note under the offer, such as a savings correction. */
  offerNote?: string;
  /** Omitted on the directory, which does not show a visit track. */
  status?: StatusTrackStatus;
  actionHref?: string;
  actionLabel?: string;
  /** Replaces the link button. Used when the action opens a dialog. */
  action?: ReactNode;
  actionVariant?: "primary" | "secondary-cream";
  actionCreamStyle?: "outline" | "plum";
  /** Real photo. The frame height stays fixed when this loads. */
  photo?: ReactNode;
  photoLabel?: string;
  photoCredit?: string;
  badge?: string;
  badgeTone?: "ready" | "wait";
  note?: ReactNode;
  children?: ReactNode;
  photoHeight?: number;
};

export function ChallengeTicket({
  name,
  area,
  offerAmount,
  offerRequirement,
  offerNote,
  status,
  actionHref,
  actionLabel,
  action,
  actionVariant = "primary",
  actionCreamStyle = "plum",
  photo,
  photoLabel,
  photoCredit,
  badge,
  badgeTone = "wait",
  note,
  children,
  photoHeight = 200,
}: ChallengeTicketProps) {
  return (
    <article className="wb-card relative" aria-label={name}>
      <div
        className="relative overflow-hidden rounded-t-[26px]"
        style={{ height: photoHeight }}
        data-photo-frame=""
        data-photo-height={photoHeight}
      >
        {photo ? (
          <div className="absolute inset-[-6%] wb-drift [&_img]:h-full [&_img]:w-full [&_img]:object-cover">{photo}</div>
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-[-6%] wb-drift"
            style={{
              background:
                "radial-gradient(circle at 35% 40%, rgba(253,186,116,0.8) 0%, rgba(253,186,116,0) 38%), radial-gradient(circle at 75% 65%, rgba(244,114,182,0.55) 0%, rgba(244,114,182,0) 42%), linear-gradient(155deg, #6b3a2a 0%, #3a1d4f 60%, #1d1033 100%)",
            }}
          />
        )}
        <span
          aria-hidden="true"
          className="wb-bokeh pointer-events-none absolute left-[68%] top-[22%] h-12 w-12 rounded-full bg-[rgba(254,215,170,0.6)] blur-md"
        />
        {badge ? (
          <span
            className="absolute left-3 top-3 inline-flex items-center rounded-full px-2.5 py-1.5 text-xs font-bold"
            style={
              badgeTone === "ready"
                ? { color: "#ffffff", background: "rgba(18,10,36,0.55)", border: "1px solid rgba(255,255,255,0.25)" }
                : { color: "var(--wb-photo-wait-fg)", background: "var(--wb-photo-wait-bg)" }
            }
          >
            {badge}
          </span>
        ) : null}
        {photoLabel ? (
          <span className="absolute bottom-3 right-3 rounded-full border border-dashed border-white/45 px-2 py-1 text-[10px] font-semibold tracking-wide text-white/85">
            {photoLabel}
          </span>
        ) : null}
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
          {area ? <span className="text-sm text-wb-muted">{area}</span> : null}
        </div>
        {offerAmount ? (
          <div className="flex items-center justify-between rounded-2xl border-[1.5px] border-dashed border-[#e3d9c6] bg-[#f4efe6] px-3.5 py-3">
            <span className="font-display text-[26px] leading-none text-wb-plum">{offerAmount}</span>
            {offerRequirement ? <span className="text-[13px] text-wb-muted"> {offerRequirement}</span> : null}
          </div>
        ) : null}
        {offerNote ? <p className="m-0 text-center text-xs text-wb-muted">{offerNote}</p> : null}
        {status ? <StatusTrack status={status} /> : null}
        {action ??
          (actionHref && actionLabel ? (
            <CtaButton href={actionHref} variant={actionVariant} creamStyle={actionCreamStyle} className="min-h-[52px] w-full">
              {actionLabel}
            </CtaButton>
          ) : null)}
        {note ? <p className="m-0 text-center text-xs text-wb-muted">{note}</p> : null}
        {children}
      </div>
    </article>
  );
}
