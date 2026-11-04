import type { ReactNode } from "react";

type StatTileProps = {
  value: ReactNode;
  label: string;
  suffix?: ReactNode;
};

export function StatTile({ value, label, suffix }: StatTileProps) {
  return (
    <div className="wb-stat-tile">
      <span className="font-display text-[30px] leading-none">
        {value}
        {suffix ? <span className="text-[18px] text-white/65">{suffix}</span> : null}
      </span>
      <span className="text-xs text-white/75">{label}</span>
    </div>
  );
}
