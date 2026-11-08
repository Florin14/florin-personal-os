import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap transition-[background,box-shadow,color,border-color,transform] duration-150 select-none active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-b from-electric-soft/95 to-electric text-white shadow-[0_0_0_1px_rgb(127_162_255/0.5),0_8px_24px_-10px_rgb(79_125_255/0.9)] hover:shadow-glow hover:brightness-110',
        secondary:
          'border border-line-strong bg-surface-2/80 text-ink hover:border-electric/60 hover:bg-surface-3',
        ghost: 'text-ink-muted hover:bg-white/5 hover:text-ink',
        outline: 'border border-line text-ink-muted hover:border-line-strong hover:text-ink',
        danger:
          'border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 hover:shadow-[0_0_18px_-6px_var(--color-danger)]',
        success:
          'border border-success/40 bg-success/10 text-success hover:bg-success/20 hover:shadow-[0_0_18px_-6px_var(--color-success)]',
        link: 'text-electric-soft underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 rounded-sm px-3 text-xs',
        md: 'h-9 rounded-md px-4 text-sm',
        lg: 'h-11 rounded-md px-5 text-sm',
        icon: 'size-9 rounded-md',
        'icon-sm': 'size-8 rounded-sm',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
