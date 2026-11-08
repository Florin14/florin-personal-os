import DevicesOutlined from '@mui/icons-material/DevicesOutlined';
import { Alert, Button, Chip, List, ListItem, ListItemText, Stack } from '@mui/material';

import { useAuthState, useRevokeSession, useSessions } from '@/api/auth';
import { errorMessage } from '@/api/client';
import type { SessionInfo } from '@/api/types';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { DashboardCard } from '@/features/dashboard/DashboardCard';

import { describeUserAgent } from './userAgent';

function SessionRow({ session, timeZone }: { session: SessionInfo; timeZone: string }) {
  const revoke = useRevokeSession();
  const lastSeen = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(session.last_seen_at));

  return (
    <ListItem
      divider
      secondaryAction={
        session.current ? (
          <Chip label="This device" color="primary" size="small" />
        ) : (
          <Button
            size="small"
            color="error"
            onClick={() => revoke.mutate(session.id)}
            loading={revoke.isPending}
            aria-label={`Sign out session from ${describeUserAgent(session.user_agent)}`}
          >
            Sign out
          </Button>
        )
      }
    >
      <ListItemText
        primary={describeUserAgent(session.user_agent)}
        secondary={`Last active ${lastSeen}${session.ip_address ? ` · ${session.ip_address}` : ''}`}
      />
      {revoke.isError && <Alert severity="error">{errorMessage(revoke.error)}</Alert>}
    </ListItem>
  );
}

export function SessionsCard() {
  const sessions = useSessions();
  const { data: auth } = useAuthState();
  const timeZone = auth?.user.timezone ?? 'UTC';

  return (
    <DashboardCard title="Active sessions" icon={<DevicesOutlined color="primary" />}>
      {sessions.isPending ? (
        <LoadingState compact />
      ) : sessions.isError ? (
        <ErrorState compact error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : sessions.data.length === 0 ? (
        <EmptyState compact title="No active sessions" />
      ) : (
        <Stack>
          <List disablePadding aria-label="Active sessions">
            {sessions.data.map((s) => (
              <SessionRow key={s.id} session={s} timeZone={timeZone} />
            ))}
          </List>
        </Stack>
      )}
    </DashboardCard>
  );
}
