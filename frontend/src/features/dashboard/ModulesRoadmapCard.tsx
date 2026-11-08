import RouteOutlined from '@mui/icons-material/RouteOutlined';
import { Box, Chip, Grid, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';

import { isAvailable, NAV_ITEMS } from '@/components/layout/navigation';

import { DashboardCard } from './DashboardCard';

/** All product areas with their availability, so the roadmap is visible in-app. */
export function ModulesRoadmapCard() {
  const items = NAV_ITEMS.filter((item) => item.path !== '/');
  return (
    <DashboardCard title="Areas & roadmap" icon={<RouteOutlined color="primary" />}>
      <Grid container spacing={1.5}>
        {items.map((item) => {
          const Icon = item.icon;
          const available = isAvailable(item);
          return (
            <Grid key={item.path} size={{ xs: 12, sm: 6, lg: 4 }}>
              <Box
                component={RouterLink}
                to={item.path}
                sx={{
                  display: 'block',
                  p: 1.5,
                  borderRadius: 2,
                  border: 1,
                  borderColor: 'divider',
                  color: 'inherit',
                  textDecoration: 'none',
                  height: '100%',
                  '&:hover': { borderColor: 'primary.main' },
                }}
              >
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                  <Icon color={available ? 'primary' : 'disabled'} aria-hidden />
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <Typography variant="subtitle2">{item.label}</Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={available ? 'success' : 'default'}
                        label={available ? 'Available' : `Phase ${item.phase}`}
                        sx={{ height: 20, fontSize: 11 }}
                      />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {item.description}
                    </Typography>
                  </Box>
                </Stack>
              </Box>
            </Grid>
          );
        })}
      </Grid>
    </DashboardCard>
  );
}
