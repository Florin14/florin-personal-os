import { ScrollText } from 'lucide-react';

import { useAuditLog } from '@/api/automation';
import { dateTime } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { Panel } from '@/components/ui/surface';

const OUTCOME_STATUS: Record<string, string> = {
  success: 'succeeded',
  failure: 'failed',
  denied: 'rejected',
};

/** Recent security-relevant activity visible to the current user. */
export function AuditLogCard({ timeZone }: { timeZone: string }) {
  const audit = useAuditLog();
  return (
    <Panel title="Recent activity" icon={<ScrollText />}>
      {audit.isPending ? (
        <LoadingState compact />
      ) : audit.isError ? (
        <ErrorState compact error={audit.error} onRetry={() => void audit.refetch()} />
      ) : audit.data.length === 0 ? (
        <EmptyState compact title="No activity recorded yet" />
      ) : (
        <ul aria-label="Audit log" className="max-h-80 overflow-y-auto">
          {audit.data.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 border-b border-line/60 py-2 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-ink">{r.action}</p>
                <p className="text-xs text-ink-dim">
                  {dateTime(r.occurred_at, timeZone)}
                  {r.ip_address ? ` · ${r.ip_address}` : ''}
                </p>
              </div>
              <StatusChip status={OUTCOME_STATUS[r.outcome] ?? r.outcome} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
