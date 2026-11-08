import type { ReactNode } from 'react';

import { Panel } from '@/components/ui/surface';

/** Titled glass panel used for dashboard and settings widgets. */
export function DashboardCard({
  title,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Panel title={title} icon={icon} action={action} className={className ?? 'h-full'}>
      {children}
    </Panel>
  );
}
