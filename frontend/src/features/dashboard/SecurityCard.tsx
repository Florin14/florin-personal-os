import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import { Button, Chip, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';

import { useAuthState, useSessions } from '@/api/auth';
import { LoadingState } from '@/components/feedback/StateViews';

import { DashboardCard } from './DashboardCard';

function formatDateTime(value: string | null | undefined, timeZone: string): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

export function SecurityCard() {
  const { data: auth } = useAuthState();
  const sessions = useSessions();
  const user = auth?.user;

  return (
    <DashboardCard
      title="Security"
      icon={<ShieldOutlined color="primary" />}
      action={
        <Button component={RouterLink} to="/settings" size="small">
          Manage
        </Button>
      }
    >
      {!user ? (
        <LoadingState compact />
      ) : (
        <Stack spacing={1.5}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Two-factor authentication
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              color={user.mfa_enabled ? 'success' : 'warning'}
              label={user.mfa_enabled ? 'Enabled' : 'Not enabled'}
            />
          </Stack>
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">
              Active sessions
            </Typography>
            {sessions.isPending ? (
              <Typography variant="body2">…</Typography>
            ) : sessions.isError ? (
              <Typography variant="body2" color="error">
                Unavailable
              </Typography>
            ) : (
              <Typography variant="body2">{sessions.data.length}</Typography>
            )}
          </Stack>
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">
              Signed in
            </Typography>
            <Typography variant="body2">
              {formatDateTime(user.last_login_at, user.timezone)}
            </Typography>
          </Stack>
        </Stack>
      )}
    </DashboardCard>
  );
}
