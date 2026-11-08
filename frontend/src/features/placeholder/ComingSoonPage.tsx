import ConstructionOutlined from '@mui/icons-material/ConstructionOutlined';
import { Card, CardContent, Chip, Stack, Typography } from '@mui/material';

import type { NavItem } from '@/components/layout/navigation';

/** Placeholder for product areas that are planned for a later phase. */
export function ComingSoonPage({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Icon color="primary" fontSize="large" aria-hidden />
        <Typography variant="h4" component="h1">
          {item.label}
        </Typography>
        <Chip label={`Planned · Phase ${item.phase}`} variant="outlined" />
      </Stack>
      <Card>
        <CardContent>
          <Stack spacing={1.5} sx={{ alignItems: 'center', py: 6, textAlign: 'center' }}>
            <ConstructionOutlined fontSize="large" color="disabled" aria-hidden />
            <Typography variant="h6" component="h2">
              Not available yet
            </Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 520 }}>
              {item.description} This area is scheduled for phase {item.phase} of the implementation
              plan.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
