import {
  Card,
  Chip,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useAuthState } from '@/api/auth';
import { useAutomations, useExecutions } from '@/api/automation';
import type { ExecutionStatus } from '@/api/types';
import { duration, relativeTime } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';

import { EmergencyStopControl } from './EmergencyStopControl';
import { ExecutionDetail } from './ExecutionDetail';
import { FailedJobsPanel } from './FailedJobsPanel';

const FILTERS: { value: ExecutionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'waiting_approval', label: 'Waiting' },
  { value: 'failed', label: 'Failed' },
  { value: 'succeeded', label: 'Succeeded' },
];

function ExecutionList() {
  const workspace = useCurrentWorkspace();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ExecutionStatus | 'all'>('all');
  const executions = useExecutions(workspace?.id, filter === 'all' ? undefined : filter);
  const automations = useAutomations(workspace?.id);
  const names = new Map((automations.data ?? []).map((a) => [a.id, a.name]));

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={filter}
        onChange={(_, value: ExecutionStatus | 'all' | null) => {
          if (value) setFilter(value);
        }}
        aria-label="Status filter"
      >
        {FILTERS.map((f) => (
          <ToggleButton key={f.value} value={f.value}>
            {f.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {!workspace ? (
        <EmptyState title="No workspace selected" />
      ) : executions.isPending ? (
        <LoadingState />
      ) : executions.isError ? (
        <ErrorState error={executions.error} onRetry={() => void executions.refetch()} />
      ) : executions.data.length === 0 ? (
        <EmptyState
          title="No executions yet"
          description="Run an automation from the Workflow Builder or wait for a trigger."
        />
      ) : (
        <Card>
          <TableContainer>
            <Table size="small" aria-label="Executions">
              <TableHead>
                <TableRow>
                  <TableCell>Automation</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Trigger</TableCell>
                  <TableCell>Started</TableCell>
                  <TableCell>Duration</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {executions.data.map((e) => (
                  <TableRow
                    key={e.id}
                    hover
                    tabIndex={0}
                    sx={{ cursor: 'pointer' }}
                    onClick={() => void navigate(`/executions/${e.id}`)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') void navigate(`/executions/${e.id}`);
                    }}
                  >
                    <TableCell>
                      {names.get(e.automation_id) ?? 'Automation'} · v{e.version}
                      {e.dry_run && (
                        <Chip size="small" label="Dry run" sx={{ ml: 1, height: 20 }} />
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={e.status} />
                    </TableCell>
                    <TableCell>{e.trigger_type}</TableCell>
                    <TableCell>{relativeTime(e.created_at)}</TableCell>
                    <TableCell>{duration(e.started_at, e.finished_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
    </Stack>
  );
}

export function ExecutionsPage() {
  const { executionId } = useParams();
  const { data: auth } = useAuthState();
  const isAdmin = auth?.user.is_admin ?? false;
  const [tab, setTab] = useState<'executions' | 'jobs'>('executions');

  if (executionId) return <ExecutionDetail id={executionId} />;

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Executions & Logs"
        subtitle="Every automation run with its steps, approvals and errors."
        actions={<EmergencyStopControl canChange={isAdmin} />}
      />
      {isAdmin && (
        <Tabs value={tab} onChange={(_, v: 'executions' | 'jobs') => setTab(v)}>
          <Tab value="executions" label="Executions" />
          <Tab value="jobs" label="System jobs" />
        </Tabs>
      )}
      {tab === 'jobs' && isAdmin ? <FailedJobsPanel /> : <ExecutionList />}
    </Stack>
  );
}
