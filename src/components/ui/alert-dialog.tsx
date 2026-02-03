'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type AlertDialogContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const AlertDialogContext = React.createContext<AlertDialogContextValue | null>(null);

function useAlertDialog() {
  const ctx = React.useContext(AlertDialogContext);
  if (!ctx) throw new Error('AlertDialog components must be used within AlertDialog');
  return ctx;
}

type AlertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};

function AlertDialog({ open, onOpenChange, children }: AlertDialogProps) {
  return (
    <AlertDialogContext.Provider value={{ open, onOpenChange }}>
      {children}
    </AlertDialogContext.Provider>
  );
}

function AlertDialogTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const { onOpenChange } = useAlertDialog();
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
      onClick: () => onOpenChange(true),
    });
  }
  return (
    <button type="button" {...props} onClick={() => onOpenChange(true)}>
      {children}
    </button>
  );
}

function AlertDialogPortal({ children }: { children: React.ReactNode }) {
  const { open } = useAlertDialog();
  if (!open) return null;
  return <>{children}</>;
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  const { onOpenChange } = useAlertDialog();
  return (
    <div
      role="presentation"
      aria-hidden
      className={cn(
        'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className
      )}
      onClick={() => onOpenChange(false)}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <div
        role="alertdialog"
        className={cn(
          'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg',
          className
        )}
        onClick={(e) => e.stopPropagation()}
        {...props}
      >
        {children}
      </div>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-2 text-center sm:text-left', className)} {...props} />;
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-lg font-semibold', className)} {...props} />;
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { onOpenChange } = useAlertDialog();
  return (
    <Button variant="outline" onClick={() => onOpenChange(false)} className={className} {...props} />
  );
}

function AlertDialogAction({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { onOpenChange } = useAlertDialog();
  return (
    <Button
      variant="default"
      className={className}
      onClick={(e) => {
        onOpenChange(false);
        onClick?.(e);
      }}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogTrigger,
};
