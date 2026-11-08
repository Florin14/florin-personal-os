import AddRounded from '@mui/icons-material/AddRounded';
import {
  Button,
  Card,
  CardContent,
  Grid,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useParams } from 'react-router';

import { useAutomation, useAutomations } from '@/api/automation';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';

import { WorkflowEditor } from './WorkflowEditor';

export default function WorkflowBuilderPage() {
  const { automationId } = useParams();
  const workspace = useCurrentWorkspace();
  const automations = useAutomations(workspace?.id);
  const isNew = automationId === 'new';
  const selected = useAutomation(workspace?.id, isNew ? undefined : automationId);
  const canEdit = workspace?.role === 'owner' || workspace?.role === 'admin';

  let editor;
  if (!workspace) editor = <EmptyState title="No workspace selected" />;
  else if (isNew)
    editor = <WorkflowEditor key="new" workspaceId={workspace.id} canEdit={canEdit} />;
  else if (!automationId) {
    editor = (
      <EmptyState
        title="Select or create an automation"
        description="Workflows are typed and versioned. Every saved change creates a new version."
        action={
          <Button component={RouterLink} to="/workflows/new" variant="contained">
            New automation
          </Button>
        }
      />
    );
  } else if (selected.isPending) editor = <LoadingState />;
  else if (selected.isError) {
    editor = <ErrorState error={selected.error} onRetry={() => void selected.refetch()} />;
  } else {
    editor = (
      <WorkflowEditor
        key={`${selected.data.id}:${String(selected.data.version)}`}
        workspaceId={workspace.id}
        automation={selected.data}
        canEdit={canEdit}
      />
    );
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Workflow Builder"
        subtitle={`Design automations for ${workspace?.name ?? 'your workspace'}.`}
      />
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 3 }}>
          <Card>
            <CardContent>
              <Button
                component={RouterLink}
                to="/workflows/new"
                startIcon={<AddRounded />}
                fullWidth
                variant="outlined"
                disabled={!canEdit}
              >
                New automation
              </Button>
              {automations.isPending ? (
                <LoadingState compact />
              ) : automations.isError ? (
                <ErrorState compact error={automations.error} />
              ) : automations.data.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  No automations yet.
                </Typography>
              ) : (
                <List dense aria-label="Automations" sx={{ mt: 1 }}>
                  {automations.data.map((a) => (
                    <ListItemButton
                      key={a.id}
                      component={RouterLink}
                      to={`/workflows/${a.id}`}
                      selected={a.id === automationId}
                      sx={{ borderRadius: 2 }}
                    >
                      <ListItemText primary={a.name} secondary={`v${String(a.version)}`} />
                      {!a.enabled && <StatusChip status="cancelled" prefix="Off" />}
                    </ListItemButton>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 9 }}>{editor}</Grid>
      </Grid>
    </Stack>
  );
}
