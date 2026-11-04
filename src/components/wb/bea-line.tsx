import type { ReactNode } from "react";
import { Bea, type BeaState } from "@/components/bea/Bea";
import { CtaButton } from "./cta-button";

type BeaAction = {
  label: string;
  href: string;
};

type BeaLineProps = {
  children: ReactNode;
  state?: BeaState;
  size?: number;
  actions?: BeaAction[];
};

export function BeaLine({ children, state = "idle", size = 32, actions }: BeaLineProps) {
  return (
    <div className="flex items-start gap-3">
      <Bea state={state} size={size} />
      <div className="flex flex-col gap-2">
        <p className="wb-voice m-0 text-[21px] text-wb-plum">{children}</p>
        {actions && actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action, index) => (
              <CtaButton
                key={action.label}
                href={action.href}
                variant="secondary-cream"
                creamStyle={index === 0 ? "plum" : "outline"}
                className="min-h-11 px-3.5 text-[13px]"
              >
                {action.label}
              </CtaButton>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
