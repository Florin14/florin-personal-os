import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Check } from 'lucide-react';
import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '@/lib/cn';

const control =
  'w-full rounded-md border border-line bg-base/70 px-3 text-sm text-ink placeholder:text-ink-dim transition-colors hover:border-line-strong focus-visible:border-electric focus-visible:shadow-[0_0_0_3px_rgb(79_125_255/0.2)] focus-visible:outline-none disabled:opacity-50 aria-invalid:border-danger/70';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(control, 'h-10', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(control, 'min-h-20 py-2 leading-relaxed', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        control,
        'h-10 appearance-none bg-[url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239aa5c7%27 stroke-width=%272%27><path d=%27m6 9 6 6 6-6%27/></svg>")] bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-9',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

/** Label + control + help/error text with proper ARIA wiring. */
export function Field({
  label,
  help,
  error,
  required,
  className,
  children,
}: {
  label: string;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error || help ? `${id}-desc` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-xs font-medium text-ink-muted">
        {label}
        {required && <span className="ml-0.5 text-cyan">*</span>}
      </label>
      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {(error ?? help) && (
        <p id={describedBy} className={cn('text-xs', error ? 'text-danger' : 'text-ink-dim')}>
          {error ?? help}
        </p>
      )}
    </div>
  );
}

export const Switch = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-surface-3 transition-colors data-[state=checked]:border-electric data-[state=checked]:bg-electric/80 disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-ink shadow transition-transform data-[state=checked]:translate-x-[18px]" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

export const Checkbox = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border border-line-strong bg-base transition-colors data-[state=checked]:border-cyan data-[state=checked]:bg-cyan/20',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator>
      <Check className="size-3.5 text-cyan" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

/** Switch with a visible, clickable label. */
export function SwitchField({
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <label htmlFor={id} className="text-sm text-ink-muted">
        {label}
      </label>
    </div>
  );
}
