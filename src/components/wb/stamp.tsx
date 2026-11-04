type CuisineInk = "pizza" | "sushi" | "american";

const INK: Record<CuisineInk, string> = {
  pizza: "var(--wb-ink-pizza)",
  sushi: "var(--wb-ink-sushi)",
  american: "var(--wb-ink-american)",
};

type StampProps = {
  name: string;
  date: string;
  neighborhood: string;
  cuisine?: CuisineInk;
  shape?: "round" | "rect";
  rotation?: number;
  href: string;
  newest?: boolean;
};

export function Stamp({
  name,
  date,
  neighborhood,
  cuisine = "pizza",
  shape = "round",
  rotation = -6,
  href,
  newest = false,
}: StampProps) {
  const ink = INK[cuisine];
  const label = `${name}, stamped ${date}${newest ? ", newest stamp" : ""}`;

  const face =
    shape === "rect" ? (
      <div
        className="flex w-36 flex-col items-center gap-1.5 px-2 py-3 text-center"
        style={{ border: `4px double ${ink}`, borderRadius: 10, color: ink }}
      >
        <span className="text-[9px] font-bold tracking-[2px]">WANDERBITE</span>
        <span className="font-display text-[28px] leading-none">{name}</span>
        <span className="w-full border-t border-dashed" style={{ borderColor: ink }} />
        <span className="text-[11px] font-bold tracking-[1.6px]">
          {date} · {neighborhood}
        </span>
      </div>
    ) : (
      <div className="h-[138px] w-[138px] rounded-full p-1.5 opacity-90" style={{ border: `3px solid ${ink}` }}>
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-full text-center"
          style={{ border: `1.5px dashed ${ink}`, color: ink }}
        >
          <span className="px-3 text-[9px] font-bold tracking-[1.5px] uppercase">{name}</span>
          <span className="font-display text-[30px] leading-none">{date}</span>
          <span className="text-[9px] font-bold tracking-[1.6px] uppercase">{neighborhood}</span>
        </div>
      </div>
    );

  return (
    <a href={href} aria-label={label} className="inline-block p-1 no-underline" style={{ transform: `rotate(${rotation}deg)` }}>
      {face}
    </a>
  );
}

export function PendingStamp({ name }: { name: string }) {
  return (
    <div
      role="img"
      aria-label={`${name}, pending. Stamps once verified.`}
      className="relative h-[138px] w-[138px]"
    >
      <span
        aria-hidden="true"
        className="wb-pending-ring absolute inset-0 box-border rounded-full border-[2.5px] border-dashed"
        style={{ borderColor: "var(--wb-ink-sushi)" }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center" style={{ color: "var(--wb-ink-sushi)" }}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
        <span className="text-xs font-bold">{name}</span>
        <span className="text-[11px] leading-snug">Stamps once verified</span>
      </div>
    </div>
  );
}

export function EmptyStampSlot({ href, challengeName }: { href: string; challengeName: string }) {
  return (
    <a
      href={href}
      className="flex h-[138px] w-[138px] flex-col items-center justify-center gap-1 rounded-full border-2 border-dashed border-wb-line px-4 text-center no-underline"
    >
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="text-wb-muted">
        <path d="M12 5v14M5 12h14" />
      </svg>
      <span className="text-xs font-bold text-wb-ink">Next stamp</span>
      <span className="text-[11px] text-wb-muted">{challengeName}</span>
    </a>
  );
}
