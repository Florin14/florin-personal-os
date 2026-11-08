import { Box, Grid, Stack, Typography } from '@mui/material';

import { useAuthState } from '@/api/auth';

import { ModulesRoadmapCard } from './ModulesRoadmapCard';
import { SecurityCard } from './SecurityCard';
import { SystemStatusCard } from './SystemStatusCard';
import { WorkspacesCard } from './WorkspacesCard';

function greeting(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Hour and long date in the user's own timezone (not the browser's). */
function localNow(timeZone: string): { hour: number; date: string } {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now),
  );
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(now);
  return { hour, date };
}

export function OverviewPage() {
  const { data } = useAuthState();
  const user = data?.user;
  const { hour, date } = localNow(user?.timezone ?? 'UTC');

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="overline" color="text.secondary">
          {date}
        </Typography>
        <Typography variant="h4" component="h1">
          {greeting(hour)}, {user?.display_name}
        </Typography>
        <Typography color="text.secondary">
          Your command center. Automations, approvals and integrations will appear here as they come
          online.
        </Typography>
      </Box>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <SystemStatusCard />
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <SecurityCard />
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <WorkspacesCard />
        </Grid>
        <Grid size={12}>
          <ModulesRoadmapCard />
        </Grid>
      </Grid>
    </Stack>
  );
}
