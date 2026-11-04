import { visitStatusLabel, type VisitStatus } from "@/lib/visits/visit-status";

const STEPS = [
  { id: "ready", label: "Ready" },
  { id: "code", label: "Code" },
  { id: "verified", label: "Verified" },
  { id: "memory", label: "Memory" },
] as const;

export type StatusTrackStatus = VisitStatus | "code" | "memory";

function currentIndex(status: StatusTrackStatus): number | "expired" | "swapped" {
  switch (status) {
    case "ready":
      return 0;
    case "code":
    case "code_issued":
    case "code_expired":
      return 1;
    case "verified":
      return 2;
    case "memory":
    case "note_added":
      return 3;
    case "expired":
      return "expired";
    case "swapped":
      return "swapped";
  }
}

function spoken(status: StatusTrackStatus): string {
  if (status === "code") return "Code";
  if (status === "memory") return "Memory";
  return visitStatusLabel(status);
}

function TrackSteps({ current, label }: { current: number; label: string }) {
  return (
    <ol aria-label={`Status: ${label}`} className="m-0 grid list-none grid-cols-4 gap-1.5 p-0">
      {STEPS.map((step, index) => {
        const filled = index <= current;
        const isCurrent = index === current;
        return (
          <li key={step.id} className="flex flex-col gap-1.5">
            <span className="wb-status-bar" data-on={filled ? "true" : "false"} />
            <span className={isCurrent ? "text-[11px] font-bold text-wb-pink-ink" : "text-[11px] text-wb-muted"}>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function StatusTrack({ status }: { status: StatusTrackStatus }) {
  const current = currentIndex(status);
  const label = spoken(status);

  if (current === "expired" || current === "swapped") {
    const badge = current === "expired" ? "Expired" : "Swapped";
    return (
      <p className="m-0 flex items-center gap-2 text-[13px]" data-visit-status={status} role="status">
        <span className="rounded-full bg-wb-wait-bg px-2 py-1 text-[11px] font-bold text-wb-wait-fg">{badge}</span>
        <span className="text-wb-muted">This adventure is no longer active.</span>
      </p>
    );
  }

  const caption =
    status === "code_issued" || status === "code_expired" || status === "note_added" ? label : null;

  return (
    <div data-visit-status={status}>
      <TrackSteps current={current} label={label} />
      {caption ? <p className="m-0 mt-1.5 text-[13px] text-wb-ink">{caption}</p> : null}
    </div>
  );
}
