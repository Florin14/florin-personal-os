import { Card, CardContent, CardHeader } from '@mui/material';
import type { ReactNode } from 'react';

/** Consistent card frame for dashboard widgets. */
export function DashboardCard({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `card-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <Card component="section" aria-labelledby={headingId} sx={{ height: '100%' }}>
      <CardHeader
        avatar={icon}
        action={action}
        title={title}
        slotProps={{ title: { id: headingId, variant: 'h6', component: 'h2' } }}
        sx={{ pb: 0 }}
      />
      <CardContent>{children}</CardContent>
    </Card>
  );
}
