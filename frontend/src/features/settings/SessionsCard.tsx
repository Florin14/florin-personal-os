import { MonitorSmartphone } from 'lucide-react';

import { useAuthState, useRevokeSession, useSessions } from '@/api/auth';
import { errorMessage } from '@/api/client';
import type { SessionInfo } from '@/api/types';
import { dateTime } from '@/components/data/format';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge, Panel } from '@/components/ui/surface';

import { describeUserAgent } from './userAgent';

function SessionRow({ session, timeZone }: { session: SessionInfo; timeZone: string }) {
  const revoke = useRevokeSession();
  const device = describeUserAgent(session.user_agent);
  return (
    <li className="flex items-center justify-between gap-3 border-b border-line/60 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-ink">{device}</p>
        <p className="text-xs text-ink-dim">
          Last active {dateTime(session.last_seen_at, timeZone)}
          {session.ip_address ? ` · ${session.ip_address}` : ''}
        </p>
        {revoke.isError && <Alert tone="danger" className="mt-1">{errorMessage(revoke.error)}</Alert>}
      </div>
      {session.current ? (
        <Badge tone="info" dot>This device</Badge>
      ) : (
        <Button
          size="sm"
          variant="danger"
          onClick={() => revoke.mutate(session.id)}
          loading={revoke.isPending}
          aria-label={`Sign out session from ${device}`}
        >
          Sign out
        </Button>
      )}
    </li>
  );
}

export function SessionsCard() {
  const sessions = useSessions();
  const { data: auth } = useAuthState();
  const timeZone = auth?.user.timezone ?? 'UTC';
  return (
    <Panel title="Active sessions" icon={<MonitorSmartphone />}>
      {sessions.isPending ? (
        <LoadingState compact />
      ) : sessions.isError ? (
        <ErrorState compact error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : sessions.data.length === 0 ? (
        <EmptyState compact title="No active sessions" />
      ) : (
        <ul aria-label="Active sessions">
          {sessions.data.map((s) => (
            <SessionRow key={s.id} session={s} timeZone={timeZone} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
