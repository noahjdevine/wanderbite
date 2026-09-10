import { cn } from '@/lib/utils';
import { AREA_HOLD_BODY, AREA_HOLD_HEADING, LAUNCH_MARKET } from '@/lib/launch-market';

type AreaHoldNoticeProps = {
  className?: string;
};

/** Non-collecting out-of-area notice. No form, no email capture. */
export function AreaHoldNotice({ className }: AreaHoldNoticeProps) {
  return (
    <div
      role="status"
      className={cn(
        'w-full rounded-lg border border-border bg-muted/40 px-4 py-3 text-center',
        className
      )}
    >
      <p className="text-sm font-semibold text-foreground">{AREA_HOLD_HEADING}</p>
      <p className="mt-1 text-sm text-muted-foreground">{AREA_HOLD_BODY}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Current launch city: {LAUNCH_MARKET.displayName}.
      </p>
    </div>
  );
}
