import { Grid, Stack, Typography } from '@mui/material';

import { useAuthState } from '@/api/auth';

import { AppearanceCard } from './AppearanceCard';
import { AuditLogCard } from './AuditLogCard';
import { ChangePasswordCard } from './ChangePasswordCard';
import { MfaCard } from './MfaCard';
import { SessionsCard } from './SessionsCard';

export function SettingsPage() {
  const { data } = useAuthState();
  return (
    <Stack spacing={3}>
      <div>
        <Typography variant="h4" component="h1">
          Settings &amp; Security
        </Typography>
        <Typography color="text.secondary">
          Manage authentication, active sessions and preferences.
        </Typography>
      </div>
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Stack spacing={2.5}>
            <MfaCard />
            <AppearanceCard />
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ChangePasswordCard />
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <SessionsCard />
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <AuditLogCard timeZone={data?.user.timezone ?? 'UTC'} />
        </Grid>
      </Grid>
    </Stack>
  );
}
