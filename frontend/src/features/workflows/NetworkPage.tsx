import { Button, Card, CardContent, Grid, Stack, Typography } from '@mui/material';
import { useMemo } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';

import { useAutomations } from '@/api/automation';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';

import { FlowCanvas } from './FlowCanvas';
import { networkGraph } from './graph';

/** Read-only map of how triggers, automations and integrations connect. */
export default function NetworkPage() {
  const workspace = useCurrentWorkspace();
  const automations = useAutomations(workspace?.id);
  const navigate = useNavigate();
  const graph = useMemo(() => networkGraph(automations.data ?? []), [automations.data]);
  const enabled = (automations.data ?? []).filter((a) => a.enabled).length;

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Automation Network"
        subtitle="Triggers on the left, automations in the middle, the systems they act on to the right."
        actions={
          <Button component={RouterLink} to="/workflows/new" variant="contained">
            New automation
          </Button>
        }
      />
      {!workspace ? (
        <EmptyState title="No workspace selected" />
      ) : automations.isPending ? (
        <LoadingState />
      ) : automations.isError ? (
        <ErrorState error={automations.error} onRetry={() => void automations.refetch()} />
      ) : automations.data.length === 0 ? (
        <EmptyState
          title="No automations yet"
          description="Create your first automation in the Workflow Builder."
        />
      ) : (
        <>
          <Grid container spacing={2}>
            {[
              ['Automations', automations.data.length],
              ['Enabled', enabled],
              ['Triggers', graph.nodes.filter((n) => n.id.startsWith('trigger:')).length],
              ['Connected systems', graph.nodes.filter((n) => n.id.startsWith('ns:')).length],
            ].map(([label, value]) => (
              <Grid key={String(label)} size={{ xs: 6, md: 3 }}>
                <Card>
                  <CardContent>
                    <Typography variant="overline" color="text.secondary">
                      {label}
                    </Typography>
                    <Typography variant="h5" component="p">
                      {value}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          <FlowCanvas
            nodes={graph.nodes}
            edges={graph.edges}
            height={560}
            label="Automation network graph"
            onNodeClick={(node) => {
              const id = (node.data as { automationId?: string }).automationId;
              if (id) void navigate(`/workflows/${id}`);
            }}
          />
          <Typography variant="body2" color="text.secondary">
            Select an automation node to open it in the Workflow Builder. Dimmed nodes are disabled.
          </Typography>
        </>
      )}
    </Stack>
  );
}
