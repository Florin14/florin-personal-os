import BusinessRounded from '@mui/icons-material/BusinessRounded';
import PersonRounded from '@mui/icons-material/PersonRounded';
import {
  FormControl,
  InputLabel,
  ListItemIcon,
  MenuItem,
  Select,
  Skeleton,
  Typography,
} from '@mui/material';

import { useWorkspaces } from '@/api/workspaces';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/** Switches between personal and business workspaces. */
export function WorkspaceSelector() {
  const { data, isPending, isError } = useWorkspaces();
  const current = useCurrentWorkspace();
  const setCurrent = useWorkspaceStore((s) => s.setCurrentWorkspaceId);

  if (isPending) return <Skeleton variant="rounded" height={40} />;
  if (isError || !data.length || !current) {
    return (
      <Typography variant="body2" color="text.secondary">
        {isError ? 'Workspaces unavailable' : 'No workspace yet'}
      </Typography>
    );
  }

  return (
    <FormControl size="small" fullWidth>
      <InputLabel id="workspace-select-label">Workspace</InputLabel>
      <Select
        labelId="workspace-select-label"
        label="Workspace"
        value={current.id}
        onChange={(e) => setCurrent(e.target.value)}
      >
        {data.map((w) => (
          <MenuItem key={w.id} value={w.id}>
            <ListItemIcon sx={{ minWidth: 28, verticalAlign: 'middle' }}>
              {w.kind === 'business' ? (
                <BusinessRounded fontSize="small" aria-label="Business" />
              ) : (
                <PersonRounded fontSize="small" aria-label="Personal" />
              )}
            </ListItemIcon>
            {w.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
