import KeyOutlined from '@mui/icons-material/KeyOutlined';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';

import { useAuthState } from '@/api/auth';
import { DashboardCard } from '@/features/dashboard/DashboardCard';

export function MfaCard() {
  const { data } = useAuthState();
  const enabled = data?.user.mfa_enabled ?? false;
  return (
    <DashboardCard title="Two-factor authentication" icon={<KeyOutlined color="primary" />}>
      <Stack spacing={2}>
        {enabled ? (
          <Alert severity="success">An authenticator app (TOTP) protects your account.</Alert>
        ) : (
          <Alert severity="warning">Two-factor authentication is not enabled.</Alert>
        )}
        <Typography variant="body2" color="text.secondary">
          Lost your device? An administrator can reset MFA on the server with{' '}
          <code>python -m app.cli reset-mfa --email &lt;email&gt;</code>. Passkeys and recovery
          codes are planned.
        </Typography>
        {!enabled && (
          <Button component={RouterLink} to="/setup/mfa" variant="contained">
            Enable two-factor authentication
          </Button>
        )}
      </Stack>
    </DashboardCard>
  );
}
