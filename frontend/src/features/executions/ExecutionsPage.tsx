import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useAuthState } from '@/api/auth';
import { useAutomations, useExecutions } from '@/api/automation';
import type { ExecutionStatus } from '@/api/types';
import { duration, relativeTime } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Badge, Panel, Table, Td, Th, Tr } from '@/components/ui/surface';
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
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as ExecutionStatus | 'all')}>
        <TabsList aria-label="Status filter">
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Panel>
        {!workspace ? (
          <EmptyState title="No workspace selected" />
        ) : executions.isPending ? (
          <LoadingState />
        ) : executions.isError ? (
          <ErrorState error={executions.error} onRetry={() => void executions.refetch()} />
        ) : executions.data.length === 0 ? (
          <EmptyState title="No executions yet" description="Run an automation from the Workflow Builder or wait for a trigger." />
        ) : (
          <Table aria-label="Executions">
            <thead>
              <tr>
                <Th>Automation</Th>
                <Th>Status</Th>
                <Th>Trigger</Th>
                <Th>Started</Th>
                <Th>Duration</Th>
              </tr>
            </thead>
            <tbody>
              {executions.data.map((e) => (
                <Tr
                  key={e.id}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => void navigate(`/executions/${e.id}`)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') void navigate(`/executions/${e.id}`);
                  }}
                >
                  <Td>
                    {names.get(e.automation_id) ?? 'Automation'} · v{e.version}
                    {e.dry_run && <Badge className="ml-2">dry run</Badge>}
                  </Td>
                  <Td><StatusChip status={e.status} /></Td>
                  <Td className="text-ink-muted">{e.trigger_type}</Td>
                  <Td className="text-ink-dim">{relativeTime(e.created_at)}</Td>
                  <Td className="font-mono text-ink-dim">{duration(e.started_at, e.finished_at)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

export function ExecutionsPage() {
  const { executionId } = useParams();
  const { data: auth } = useAuthState();
  const isAdmin = auth?.user.is_admin ?? false;
  const [tab, setTab] = useState<'executions' | 'jobs'>('executions');
  if (executionId) return <ExecutionDetail id={executionId} />;
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Command"
        title="Executions & Logs"
        subtitle="Every automation run with its steps, approvals and errors."
        actions={<EmergencyStopControl canChange={isAdmin} />}
      />
      {isAdmin && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'executions' | 'jobs')}>
          <TabsList>
            <TabsTrigger value="executions">Executions</TabsTrigger>
            <TabsTrigger value="jobs">System jobs</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {tab === 'jobs' && isAdmin ? <FailedJobsPanel /> : <ExecutionList />}
    </div>
  );
}
