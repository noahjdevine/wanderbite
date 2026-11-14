import type { ReactNode } from "react";

type BadgeMedallionProps = {
  name: string;
  earned: boolean;
  icon: ReactNode;
  earnedLabel?: string;
  progress?: { current: number; target: number };
  /** Catalog sentence. Hidden when it repeats the name. */
  description?: string;
};

export function BadgeMedallion({ name, earned, icon, earnedLabel, progress, description }: BadgeMedallionProps) {
  const fraction = progress && progress.target > 0 ? Math.max(0, Math.min(1, progress.current / progress.target)) : 0;
  const turn = `${Math.round(fraction * 100)}%`;
  const detail = description && description !== name ? description : null;

  return (
    <div className="flex w-[84px] flex-col items-center gap-2 text-center" title={detail ?? undefined}>
      {earned ? (
        <span
          aria-hidden="true"
          className="relative flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-full text-white"
          style={{
            background: "radial-gradient(circle at 30% 25%, var(--wb-lavender) 0%, var(--wb-violet-2) 42%, var(--wb-plum) 100%)",
            boxShadow: "0 10px 22px rgba(109,40,217,0.35), inset 0 2px 0 rgba(255,255,255,0.4)",
          }}
        >
          {icon}
          <span
            aria-hidden="true"
            className="wb-shine pointer-events-none absolute top-[-20px] left-0 h-[110px] w-[22px] bg-white/45 blur-[2px]"
          />
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="flex h-[72px] w-[72px] items-center justify-center rounded-full"
          style={{ background: `conic-gradient(var(--wb-pink) 0 ${turn}, var(--wb-line) ${turn} 100%)` }}
        >
          <span className="flex h-[62px] w-[62px] items-center justify-center rounded-full bg-wb-cream text-wb-muted">
            {icon}
          </span>
        </span>
      )}
      <span className="text-[13px] font-semibold text-wb-ink">{name}</span>
      <span className="text-[11px] text-wb-muted">
        {earned ? earnedLabel : progress ? `${progress.current} of ${progress.target}` : "Locked"}
      </span>
      {detail ? <span className="sr-only">{detail}</span> : null}
    </div>
  );
}
