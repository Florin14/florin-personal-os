import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

const STYLES = {
  info: ['border-cyan/30 bg-cyan/[0.07] text-ink', Info, 'text-cyan'],
  success: ['border-success/30 bg-success/[0.07] text-ink', CheckCircle2, 'text-success'],
  warning: ['border-warning/30 bg-warning/[0.07] text-ink', AlertTriangle, 'text-warning'],
  danger: ['border-danger/35 bg-danger/[0.08] text-ink', XCircle, 'text-danger'],
} as const;

/** Inline message (errors are announced to assistive technology). */
export function Alert({
  tone = 'info',
  children,
  action,
  className,
}: {
  tone?: keyof typeof STYLES;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const [style, Icon, iconColor] = STYLES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm',
        style,
        className,
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconColor)} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
