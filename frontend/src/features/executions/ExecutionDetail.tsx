import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ErrorRounded from '@mui/icons-material/ErrorRounded';
import HourglassTopRounded from '@mui/icons-material/HourglassTopRounded';
import RemoveCircleOutlineRounded from '@mui/icons-material/RemoveCircleOutlineRounded';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router';

import { errorMessage } from '@/api/client';
import { isActive, useCancelExecution, useExecution } from '@/api/automation';
import type { StepRun } from '@/api/types';
import { dateTime, duration, statusLabel } from '@/components/data/format';
import { KeyValueView } from '@/components/data/KeyValueView';
import { StatusChip } from '@/components/data/StatusChip';
import { ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';

function StepIcon({ status }: { status: string }) {
  if (status === 'succeeded') return <CheckCircleRounded color="success" aria-hidden />;
  if (status === 'failed') return <ErrorRounded color="error" aria-hidden />;
  if (status === 'skipped') return <RemoveCircleOutlineRounded color="disabled" aria-hidden />;
  return <HourglassTopRounded color="warning" aria-hidden />;
}

function StepItem({ step }: { step: StepRun }) {
  return (
    <Accordion disableGutters>
      <AccordionSummary aria-controls={`step-${step.step_key}`}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', width: '100%' }}>
          <StepIcon status={step.status} />
          <Typography sx={{ fontWeight: 600 }}>{step.step_key}</Typography>
          <Chip size="small" label={step.step_type} variant="outlined" />
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {statusLabel(step.status)}
            {step.attempts > 1 ? ` · ${step.attempts} attempts` : ''}
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails id={`step-${step.step_key}`}>
        <Stack spacing={1.5}>
          {step.error && <Alert severity="error">{step.error}</Alert>}
          {step.approval_id && (
            <Button
              component={RouterLink}
              to={`/approvals/${step.approval_id}`}
              size="small"
              sx={{ alignSelf: 'flex-start' }}
            >
              View approval
            </Button>
          )}
          <Typography variant="subtitle2">Input</Typography>
          <KeyValueView data={step.input} emptyLabel="No input" label="Step input" />
          <Typography variant="subtitle2">Output</Typography>
          <KeyValueView data={step.output} emptyLabel="No output" label="Step output" />
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export function ExecutionDetail({ id }: { id: string }) {
  const workspace = useCurrentWorkspace();
  const execution = useExecution(workspace?.id, id);
  const cancel = useCancelExecution(workspace?.id);

  if (execution.isPending) return <LoadingState />;
  if (execution.isError) {
    return <ErrorState error={execution.error} onRetry={() => void execution.refetch()} />;
  }
  const e = execution.data;
  const active = isActive(e.status);

  return (
    <Stack spacing={3}>
      <Button
        component={RouterLink}
        to="/executions"
        startIcon={<ArrowBackRounded />}
        sx={{ alignSelf: 'flex-start' }}
      >
        All executions
      </Button>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1">
          Execution
        </Typography>
        <StatusChip status={e.status} />
        {e.dry_run && <Chip label="Dry run" />}
        <Box sx={{ flexGrow: 1 }} />
        {active && (
          <Button
            color="error"
            variant="outlined"
            onClick={() => cancel.mutate(e.id)}
            disabled={e.cancel_requested}
            loading={cancel.isPending}
          >
            {e.cancel_requested ? 'Cancelling…' : 'Cancel execution'}
          </Button>
        )}
      </Stack>
      {cancel.isError && <Alert severity="error">{errorMessage(cancel.error)}</Alert>}
      {e.error && <Alert severity="error">{e.error}</Alert>}
      {e.status === 'waiting_approval' && (
        <Alert severity="warning">
          Waiting for an approval. Review it in the{' '}
          <RouterLink to="/approvals">Approval Inbox</RouterLink>.
        </Alert>
      )}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <KeyValueView
                label="Execution summary"
                data={{
                  version: e.version,
                  trigger: `${e.trigger_type} (${e.trigger_key})`,
                  started: dateTime(e.started_at),
                  finished: dateTime(e.finished_at),
                  duration: duration(e.started_at, e.finished_at),
                  'current step': e.current_step_key,
                }}
              />
            </CardContent>
          </Card>
          <Card sx={{ mt: 2.5 }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Trigger payload
              </Typography>
              <KeyValueView data={e.trigger_payload} emptyLabel="Empty" label="Trigger payload" />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <Typography variant="h6" component="h2" gutterBottom>
            Steps
          </Typography>
          {e.steps.length === 0 ? (
            <Typography color="text.secondary">
              {active ? 'Starting…' : 'No steps were executed.'}
            </Typography>
          ) : (
            <Box>
              {e.steps.map((s) => (
                <StepItem key={s.step_key} step={s} />
              ))}
            </Box>
          )}
        </Grid>
      </Grid>
    </Stack>
  );
}
