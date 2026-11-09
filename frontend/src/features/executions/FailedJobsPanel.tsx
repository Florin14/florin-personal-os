import { errorMessage } from '@/api/client';
import { useJobs, useJobStats, useRetryJob } from '@/api/automation';
import { relativeTime } from '@/components/data/format';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Metric, Panel, Table, Td, Th, Tr } from '@/components/ui/surface';

/** Administrators can inspect and retry dead-lettered background jobs. */
export function FailedJobsPanel() {
  const stats = useJobStats(true);
  const jobs = useJobs('failed', true);
  const retry = useRetryJob();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(['queued', 'running', 'succeeded', 'failed'] as const).map((key) => (
          <Metric
            key={key}
            label={key}
            value={stats.data ? stats.data[key] : '—'}
            tone={key === 'failed' && (stats.data?.failed ?? 0) > 0 ? 'danger' : 'neutral'}
          />
        ))}
      </div>
      {retry.isError && <Alert tone="danger">{errorMessage(retry.error)}</Alert>}
      <Panel title="Failed jobs">
        {jobs.isPending ? (
          <LoadingState compact />
        ) : jobs.isError ? (
          <ErrorState compact error={jobs.error} onRetry={() => void jobs.refetch()} />
        ) : jobs.data.length === 0 ? (
          <EmptyState compact title="No failed jobs" description="Background work is healthy." />
        ) : (
          <Table aria-label="Failed jobs">
            <thead>
              <tr>
                <Th>Kind</Th>
                <Th>Failure</Th>
                <Th>Error</Th>
                <Th>Attempts</Th>
                <Th>Updated</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {jobs.data.map((job) => (
                <Tr key={job.id}>
                  <Td className="font-mono text-xs">{job.kind}</Td>
                  <Td>{job.failure_class ?? '—'}</Td>
                  <Td className="max-w-sm break-words text-ink-muted">{job.last_error ?? '—'}</Td>
                  <Td className="font-mono">
                    {job.attempts}/{job.max_attempts}
                  </Td>
                  <Td className="text-ink-dim">{relativeTime(job.updated_at)}</Td>
                  <Td>
                    <Button
                      size="sm"
                      onClick={() => retry.mutate(job.id)}
                      loading={retry.isPending && retry.variables === job.id}
                      aria-label={`Retry job ${job.kind}`}
                    >
                      Retry
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
