import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';

import { cn } from '@/lib/cn';

/** Glass surface with an optional titled header. Sharp-ish corners, thin luminous border. */
export function Panel({
  title,
  icon,
  action,
  children,
  className,
  bodyClassName,
  as: Tag = 'section',
  ...rest
}: {
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'article';
} & Omit<HTMLAttributes<HTMLElement>, 'title'>) {
  const headingId = title ? `panel-${title.toLowerCase().replace(/\W+/g, '-')}` : undefined;
  return (
    <Tag
      aria-labelledby={headingId}
      className={cn('glass relative flex flex-col overflow-hidden rounded-lg', className)}
      {...rest}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-electric/50 to-transparent"
      />
      {title && (
        <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
          {icon && <span className="text-cyan [&_svg]:size-4">{icon}</span>}
          <h2 id={headingId} className="flex-1 font-display text-sm font-semibold tracking-wide">
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className={cn('flex-1 px-4 pb-4', !title && 'pt-4', bodyClassName)}>{children}</div>
    </Tag>
  );
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'electric' | 'violet';

const TONES: Record<Tone, string> = {
  neutral: 'border-line-strong text-ink-muted bg-white/[0.03]',
  info: 'border-cyan/35 text-cyan bg-cyan/10',
  success: 'border-success/35 text-success bg-success/10',
  warning: 'border-warning/35 text-warning bg-warning/10',
  danger: 'border-danger/35 text-danger bg-danger/10',
  electric: 'border-electric/40 text-electric-soft bg-electric/10',
  violet: 'border-violet/40 text-violet bg-violet/10',
};

const DOTS: Record<Tone, string> = {
  neutral: 'bg-ink-dim',
  info: 'bg-cyan shadow-[0_0_8px_var(--color-cyan)]',
  success: 'bg-success shadow-[0_0_8px_var(--color-success)]',
  warning: 'bg-warning shadow-[0_0_8px_var(--color-warning)]',
  danger: 'bg-danger shadow-[0_0_8px_var(--color-danger)]',
  electric: 'bg-electric shadow-[0_0_8px_var(--color-electric)]',
  violet: 'bg-violet shadow-[0_0_8px_var(--color-violet)]',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-sm border px-1.5 font-mono text-[10.5px] font-medium tracking-wide whitespace-nowrap uppercase',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', DOTS[tone])} aria-hidden />}
      {children}
    </span>
  );
}

export function StatusDot({
  tone,
  pulse = false,
  label,
}: {
  tone: Tone;
  pulse?: boolean;
  label?: string;
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('inline-block size-2 rounded-full', DOTS[tone], pulse && 'animate-pulse-soft')}
    />
  );
}

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-line px-4 py-2 text-left font-mono text-[10.5px] font-medium tracking-[0.14em] text-ink-dim uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('border-b border-line/60 px-4 py-2.5 align-top', className)} {...props} />
  );
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-electric/[0.05]', className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse-soft rounded-sm bg-surface-3', className)} aria-hidden />
  );
}

/** Big number tile for dashboards. */
export function Metric({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="glass rounded-lg px-4 py-3">
      <p className="label-caps">{label}</p>
      <p
        className={cn(
          'mt-1 font-display text-2xl font-semibold tabular-nums',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-dim">{hint}</p>}
    </div>
  );
}
