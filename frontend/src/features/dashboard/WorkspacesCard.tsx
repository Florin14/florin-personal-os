import BusinessRounded from '@mui/icons-material/BusinessRounded';
import LayersOutlined from '@mui/icons-material/LayersOutlined';
import PersonRounded from '@mui/icons-material/PersonRounded';
import { Chip, List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';

import { useWorkspaces } from '@/api/workspaces';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import { DashboardCard } from './DashboardCard';

export function WorkspacesCard() {
  const workspaces = useWorkspaces();
  const current = useCurrentWorkspace();
  const setCurrent = useWorkspaceStore((s) => s.setCurrentWorkspaceId);

  return (
    <DashboardCard title="Workspaces" icon={<LayersOutlined color="primary" />}>
      {workspaces.isPending ? (
        <LoadingState compact />
      ) : workspaces.isError ? (
        <ErrorState compact error={workspaces.error} onRetry={() => void workspaces.refetch()} />
      ) : workspaces.data.length === 0 ? (
        <EmptyState
          compact
          title="No workspaces yet"
          description="Create one with: python -m app.cli create-workspace"
        />
      ) : (
        <List dense disablePadding aria-label="Workspaces">
          {workspaces.data.map((w) => (
            <ListItemButton
              key={w.id}
              selected={w.id === current?.id}
              onClick={() => setCurrent(w.id)}
              sx={{ borderRadius: 2 }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                {w.kind === 'business' ? <BusinessRounded /> : <PersonRounded />}
              </ListItemIcon>
              <ListItemText
                primary={w.name}
                secondary={`${w.kind === 'business' ? 'Business' : 'Personal'} · ${w.default_currency} · ${w.timezone}`}
              />
              <Chip size="small" label={w.role} variant="outlined" />
            </ListItemButton>
          ))}
        </List>
      )}
    </DashboardCard>
  );
}
