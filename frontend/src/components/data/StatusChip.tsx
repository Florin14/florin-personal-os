import { Badge, type Tone } from '@/components/ui/surface';

import { statusLabel } from './format';

const TONES: Record<string, Tone> = {
  pending: 'neutral',
  queued: 'neutral',
  running: 'info',
  waiting_approval: 'warning',
  waiting_delay: 'info',
  waiting: 'warning',
  succeeded: 'success',
  delivered: 'success',
  issued: 'success',
  active: 'success',
  approved: 'success',
  failed: 'danger',
  error: 'danger',
  rejected: 'danger',
  cancelled: 'neutral',
  disabled: 'neutral',
  expired: 'neutral',
  skipped: 'neutral',
  unmatched: 'warning',
  suggested: 'info',
  matched: 'success',
  confirmed: 'success',
  ignored: 'neutral',
  low: 'success',
  medium: 'warning',
  high: 'danger',
};

function toneFor(status: string): Tone {
  return TONES[status] ?? 'neutral';
}

/** Consistent label for statuses and risk levels across the app. */
export function StatusChip({ status, prefix }: { status: string; prefix?: string }) {
  return (
    <Badge tone={toneFor(status)} dot>
      {prefix ? `${prefix} · ${statusLabel(status)}` : statusLabel(status)}
    </Badge>
  );
}
