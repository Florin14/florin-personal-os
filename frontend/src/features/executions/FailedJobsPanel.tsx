import {
  Alert,
  Button,
  Card,
  CardContent,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import { errorMessage } from '@/api/client';
import { useJobs, useJobStats, useRetryJob } from '@/api/automation';
import { relativeTime } from '@/components/data/format';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';

/** Administrators can inspect and retry dead-lettered background jobs. */
export function FailedJobsPanel() {
  const stats = useJobStats(true);
  const jobs = useJobs('failed', true);
  const retry = useRetryJob();

  return (
    <Stack spacing={2.5}>
      <Grid container spacing={2}>
        {(['queued', 'running', 'succeeded', 'failed'] as const).map((key) => (
          <Grid key={key} size={{ xs: 6, md: 3 }}>
            <Card>
              <CardContent>
                <Typography variant="overline" color="text.secondary">
                  {key}
                </Typography>
                <Typography variant="h5" component="p">
                  {stats.data ? stats.data[key] : '—'}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
      {retry.isError && <Alert severity="error">{errorMessage(retry.error)}</Alert>}
      {jobs.isPending ? (
        <LoadingState />
      ) : jobs.isError ? (
        <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : jobs.data.length === 0 ? (
        <EmptyState title="No failed jobs" description="Background work is healthy." />
      ) : (
        <Card>
          <TableContainer>
            <Table size="small" aria-label="Failed jobs">
              <TableHead>
                <TableRow>
                  <TableCell>Kind</TableCell>
                  <TableCell>Failure</TableCell>
                  <TableCell>Error</TableCell>
                  <TableCell>Attempts</TableCell>
                  <TableCell>Updated</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {jobs.data.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{job.kind}</TableCell>
                    <TableCell>{job.failure_class ?? '—'}</TableCell>
                    <TableCell sx={{ maxWidth: 360, wordBreak: 'break-word' }}>
                      {job.last_error ?? '—'}
                    </TableCell>
                    <TableCell>
                      {job.attempts}/{job.max_attempts}
                    </TableCell>
                    <TableCell>{relativeTime(job.updated_at)}</TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        onClick={() => retry.mutate(job.id)}
                        loading={retry.isPending && retry.variables === job.id}
                        aria-label={`Retry job ${job.kind}`}
                      >
                        Retry
                      </Button>
                    </TableCell>
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
