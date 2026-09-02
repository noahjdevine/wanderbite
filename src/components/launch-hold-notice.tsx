import { cn } from '@/lib/utils';

export const LAUNCH_HOLD_HEADING = 'Launching soon';

export const LAUNCH_HOLD_BODY =
  'Paid membership checkout is paused. We are not collecting emails or waitlist details yet.';

type LaunchHoldNoticeProps = {
  className?: string;
};

/** Non-collecting launch-hold copy. No form, no email capture. */
export function LaunchHoldNotice({ className }: LaunchHoldNoticeProps) {
  return (
    <div
      role="status"
      className={cn(
        'w-full rounded-lg border border-border bg-muted/40 px-4 py-3 text-center',
        className
      )}
    >
      <p className="text-sm font-semibold text-foreground">{LAUNCH_HOLD_HEADING}</p>
      <p className="mt-1 text-sm text-muted-foreground">{LAUNCH_HOLD_BODY}</p>
    </div>
  );
}
