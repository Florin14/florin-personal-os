import HistoryEduOutlined from '@mui/icons-material/HistoryEduOutlined';
import { List, ListItem, ListItemText } from '@mui/material';

import { useAuditLog } from '@/api/automation';
import { dateTime } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { DashboardCard } from '@/features/dashboard/DashboardCard';

const OUTCOME_STATUS: Record<string, string> = {
  success: 'succeeded',
  failure: 'failed',
  denied: 'rejected',
};

/** Recent security-relevant activity visible to the current user. */
export function AuditLogCard({ timeZone }: { timeZone: string }) {
  const audit = useAuditLog();
  return (
    <DashboardCard title="Recent activity" icon={<HistoryEduOutlined color="primary" />}>
      {audit.isPending ? (
        <LoadingState compact />
      ) : audit.isError ? (
        <ErrorState compact error={audit.error} onRetry={() => void audit.refetch()} />
      ) : audit.data.length === 0 ? (
        <EmptyState compact title="No activity recorded yet" />
      ) : (
        <List
          dense
          disablePadding
          aria-label="Audit log"
          sx={{ maxHeight: 360, overflowY: 'auto' }}
        >
          {audit.data.map((r) => (
            <ListItem
              key={r.id}
              divider
              secondaryAction={<StatusChip status={OUTCOME_STATUS[r.outcome] ?? r.outcome} />}
            >
              <ListItemText
                primary={r.action}
                secondary={`${dateTime(r.occurred_at, timeZone)}${r.ip_address ? ` · ${r.ip_address}` : ''}`}
                slotProps={{ primary: { sx: { fontFamily: 'monospace', fontSize: 13 } } }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </DashboardCard>
  );
}
