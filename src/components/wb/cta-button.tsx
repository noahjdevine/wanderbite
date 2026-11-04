import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type CtaVariant = "primary" | "secondary-dark" | "secondary-cream";

type Common = {
  variant?: CtaVariant;
  /** On cream, secondary is an outline or a plum fill. */
  creamStyle?: "outline" | "plum";
  className?: string;
  children: ReactNode;
};

type IconOnly = { iconOnly: true; "aria-label": string };
type Labeled = { iconOnly?: false };

type ButtonProps = Common &
  (IconOnly | Labeled) &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className"> & { href?: undefined };

type LinkProps = Common &
  (IconOnly | Labeled) &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "className"> & { href: string };

export type CtaButtonProps = ButtonProps | LinkProps;

function classes(variant: CtaVariant, creamStyle: "outline" | "plum", iconOnly: boolean, className?: string) {
  const look =
    variant === "primary"
      ? "wb-cta"
      : variant === "secondary-dark"
        ? "wb-cta-secondary wb-cta-secondary-dark"
        : creamStyle === "plum"
          ? "wb-cta-plum"
          : "wb-cta-secondary wb-cta-secondary-cream";
  return cn(look, iconOnly && "wb-cta-icon", className);
}

export function CtaButton(props: CtaButtonProps) {
  const {
    variant = "primary",
    creamStyle = "outline",
    iconOnly = false,
    className,
    children,
    ...rest
  } = props;
  const classNames = classes(variant, creamStyle, iconOnly, className);

  if ("href" in rest && rest.href) {
    return (
      <a className={classNames} {...rest}>
        {children}
      </a>
    );
  }

  const buttonRest = rest as Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">;
  return (
    <button type={buttonRest.type ?? "button"} className={classNames} {...buttonRest}>
      {children}
    </button>
  );
}
