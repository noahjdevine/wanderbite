import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type OpenStatProps = {
  value: ReactNode;
  label: ReactNode;
  /** When true, the caption says the figure is estimated. */
  estimated?: boolean;
  /** Short note under the caption, such as a review correction. */
  note?: string;
  divided?: boolean;
};

export function OpenStat({ value, label, estimated = false, note, divided = false }: OpenStatProps) {
  return (
    <div className={cn("wb-open-stat", divided && "border-l border-wb-line pl-3")}>
      <span className="font-display text-[44px] leading-none text-wb-plum">{value}</span>
      <span className="text-[13px] leading-snug text-wb-muted">
        {label}
        {estimated ? (
          <>
            <br />
            (estimated)
          </>
        ) : null}
        {note ? (
          <>
            <br />
            {note}
          </>
        ) : null}
      </span>
    </div>
  );
}
