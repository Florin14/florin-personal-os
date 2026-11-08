import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="label-caps mb-1.5">{eyebrow}</p>}
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
          {title}
        </h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
