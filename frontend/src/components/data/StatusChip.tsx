import { Chip, type ChipProps } from '@mui/material';

import { statusLabel } from './format';

type Color = NonNullable<ChipProps['color']>;

const COLORS: Record<string, Color> = {
  // executions / jobs / steps
  pending: 'default',
  queued: 'default',
  running: 'info',
  waiting_approval: 'warning',
  waiting_delay: 'info',
  waiting: 'warning',
  succeeded: 'success',
  delivered: 'success',
  failed: 'error',
  cancelled: 'default',
  rejected: 'error',
  expired: 'default',
  skipped: 'default',
  // approvals
  approved: 'success',
  // risk
  low: 'success',
  medium: 'warning',
  high: 'error',
};

/** Consistent colored label for statuses and risk levels across the app. */
export function StatusChip({ status, prefix }: { status: string; prefix?: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={COLORS[status] ?? 'default'}
      label={prefix ? `${prefix}: ${statusLabel(status)}` : statusLabel(status)}
      sx={{ fontWeight: 600 }}
    />
  );
}
