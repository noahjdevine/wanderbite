'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

const DropdownMenuContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

function useDropdownMenu() {
  const ctx = React.useContext(DropdownMenuContext);
  if (!ctx) throw new Error('Dropdown components must be used within DropdownMenu');
  return ctx;
}

function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block text-left">{children}</div>
    </DropdownMenuContext.Provider>
  );
}

function DropdownMenuTrigger({
  children,
  className,
  asChild,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { open, setOpen } = useDropdownMenu();
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
      onClick: (e: React.MouseEvent) => {
        setOpen(!open);
        (children as React.ReactElement<{ onClick?: () => void }>).props?.onClick?.(e);
      },
    });
  }
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={() => setOpen(!open)}
      className={cn(className)}
      {...props}
    >
      {children}
    </button>
  );
}

function DropdownMenuContent({
  children,
  className,
  align = 'end',
  ...props
}: React.ComponentProps<'div'> & { align?: 'start' | 'end' }) {
  const { open, setOpen } = useDropdownMenu();
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="menu"
      className={cn(
        'absolute z-50 mt-1 flex min-w-[10rem] flex-col overflow-hidden rounded-md border bg-popover p-2 text-popover-foreground shadow-md',
        align === 'end' ? 'right-0' : 'left-0',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function DropdownMenuItem({
  children,
  className,
  asChild,
  onClick,
  ...props
}: React.ComponentProps<'div'> & { asChild?: boolean }) {
  const { setOpen } = useDropdownMenu();
  const handleClick = (e: React.MouseEvent) => {
    setOpen(false);
    onClick?.(e);
  };
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
    return React.cloneElement(child, {
      onClick: (e: React.MouseEvent) => {
        handleClick(e);
        child.props?.onClick?.(e);
      },
    });
  }
  return (
    <div
      role="menuitem"
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-md px-2 py-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground',
        className
      )}
      onClick={handleClick}
      {...props}
    >
      {children}
    </div>
  );
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem };
