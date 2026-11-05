import type { ComponentType, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type GlassTabItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type GlassTabLinkProps = {
  href: string;
  className?: string;
  "aria-current"?: "page";
  children: ReactNode;
};

type GlassTabBarProps = {
  items: readonly GlassTabItem[];
  activeHref: string | null;
  ariaLabel?: string;
  className?: string;
  /** Defaults to a plain anchor so the dev gallery markup stays the same. */
  linkComponent?: ComponentType<GlassTabLinkProps>;
};

export function GlassTabBar({
  items,
  activeHref,
  ariaLabel = "Main",
  className,
  linkComponent,
}: GlassTabBarProps) {
  const LinkView = linkComponent ?? "a";
  return (
    <nav aria-label={ariaLabel} className={cn("wb-tabbar px-1", className)} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => {
        const active = item.href === activeHref;
        const Icon = item.icon;
        return (
          <LinkView
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px] no-underline",
              active ? "font-bold text-wb-blush" : "font-medium text-white/75"
            )}
          >
            <Icon aria-hidden="true" width={22} height={22} strokeWidth={2} />
            {item.label}
          </LinkView>
        );
      })}
    </nav>
  );
}
