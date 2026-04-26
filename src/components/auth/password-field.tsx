'use client';

import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type PasswordFieldProps = {
  id?: string;
  /** Omit or pass empty string to hide the label row (use when you label externally). */
  label?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  autoComplete?: string;
  error?: string | null;
  placeholder?: string;
};

export function PasswordField({
  id: idProp,
  label,
  value,
  onChange,
  onBlur,
  disabled,
  autoComplete = 'current-password',
  error,
  placeholder = '••••••••',
}: PasswordFieldProps) {
  const genId = useId();
  const id = idProp ?? genId;
  const [show, setShow] = useState(false);

  return (
    <div className="space-y-2">
      {label ? (
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(
            'w-full rounded-md border border-input bg-background py-2 pl-3 pr-11 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20'
          )}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
          onClick={() => setShow((s) => !s)}
          disabled={disabled}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
