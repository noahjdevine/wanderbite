const STEPS = [
  { id: "ready", label: "Ready" },
  { id: "code", label: "Code" },
  { id: "verified", label: "Verified" },
  { id: "memory", label: "Memory" },
] as const;

export type StatusTrackStatus =
  | "ready"
  | "code"
  | "code_issued"
  | "verified"
  | "memory"
  | "note_added"
  | "expired"
  | "swapped";

function currentIndex(status: StatusTrackStatus): number | "expired" | "swapped" {
  switch (status) {
    case "ready":
      return 0;
    case "code":
    case "code_issued":
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

export function StatusTrack({ status }: { status: StatusTrackStatus }) {
  const current = currentIndex(status);

  if (current === "expired" || current === "swapped") {
    const label = current === "expired" ? "Expired" : "Swapped";
    return (
      <p className="m-0 flex items-center gap-2 text-[13px]" role="status">
        <span className="rounded-full bg-wb-wait-bg px-2 py-1 text-[11px] font-bold text-wb-wait-fg">{label}</span>
        <span className="text-wb-muted">This adventure is no longer active.</span>
      </p>
    );
  }

  const spoken = STEPS[current].label;
  return (
    <ol
      aria-label={`Status: ${spoken}`}
      className="m-0 grid list-none grid-cols-4 gap-1.5 p-0"
    >
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
