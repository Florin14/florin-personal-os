import { ArrowLeft, CheckCircle2, ChevronDown, CircleDashed, Hourglass, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { errorMessage } from '@/api/client';
import { isActive, useCancelExecution, useExecution } from '@/api/automation';
import type { StepRun } from '@/api/types';
import { dateTime, duration, statusLabel } from '@/components/data/format';
import { KeyValueView } from '@/components/data/KeyValueView';
import { StatusChip } from '@/components/data/StatusChip';
import { ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge, Panel } from '@/components/ui/surface';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { cn } from '@/lib/cn';

function StepIcon({ status }: { status: string }) {
  if (status === 'succeeded') return <CheckCircle2 className="size-4 text-success" aria-hidden />;
  if (status === 'failed') return <XCircle className="size-4 text-danger" aria-hidden />;
  if (status === 'skipped') return <CircleDashed className="size-4 text-ink-dim" aria-hidden />;
  return <Hourglass className="size-4 text-warning" aria-hidden />;
}

function StepItem({ step }: { step: StepRun }) {
  const [open, setOpen] = useState(step.status === 'failed');
  return (
    <li className="relative pl-7">
      <span className="absolute top-3 left-2 h-full w-px bg-line" aria-hidden />
      <span className="absolute top-2.5 left-0 rounded-full bg-base p-0.5"><StepIcon status={step.status} /></span>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`step-${step.step_key}`}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-white/[0.03]"
      >
        <span className="font-medium">{step.step_key}</span>
        <Badge>{step.step_type}</Badge>
        <span className="ml-auto text-xs text-ink-dim">
          {statusLabel(step.status)}
          {step.attempts > 1 ? ` · ${String(step.attempts)} attempts` : ''}
        </span>
        <ChevronDown className={cn('size-4 text-ink-dim transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={`step-${step.step_key}`} className="mb-3 space-y-3 rounded-md border border-line bg-base/50 p-3">
          {step.error && <Alert tone="danger">{step.error}</Alert>}
          {step.approval_id && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/approvals/${step.approval_id}`}>View approval</Link>
            </Button>
          )}
          <div>
            <p className="label-caps mb-1">Input</p>
            <KeyValueView data={step.input} emptyLabel="No input" label="Step input" />
          </div>
          <div>
            <p className="label-caps mb-1">Output</p>
            <KeyValueView data={step.output} emptyLabel="No output" label="Step output" />
          </div>
        </div>
      )}
    </li>
  );
}

export function ExecutionDetail({ id }: { id: string }) {
  const workspace = useCurrentWorkspace();
  const execution = useExecution(workspace?.id, id);
  const cancel = useCancelExecution(workspace?.id);
  if (execution.isPending) return <LoadingState />;
  if (execution.isError) return <ErrorState error={execution.error} onRetry={() => void execution.refetch()} />;
  const e = execution.data;
  const active = isActive(e.status);
  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm">
        <Link to="/executions"><ArrowLeft /> All executions</Link>
      </Button>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold">Execution</h1>
        <StatusChip status={e.status} />
        {e.dry_run && <Badge tone="violet">dry run</Badge>}
        {active && (
          <Button className="ml-auto" variant="danger" onClick={() => cancel.mutate(e.id)} disabled={e.cancel_requested} loading={cancel.isPending}>
            {e.cancel_requested ? 'Cancelling…' : 'Cancel execution'}
          </Button>
        )}
      </div>
      {cancel.isError && <Alert tone="danger">{errorMessage(cancel.error)}</Alert>}
      {e.error && <Alert tone="danger">{e.error}</Alert>}
      {e.status === 'waiting_approval' && (
        <Alert tone="warning">
          Waiting for an approval. Review it in the <Link className="text-cyan underline" to="/approvals">Approval Inbox</Link>.
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Panel title="Summary">
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
          </Panel>
          <Panel title="Trigger payload">
            <KeyValueView data={e.trigger_payload} emptyLabel="Empty" label="Trigger payload" />
          </Panel>
        </div>
        <Panel title="Steps">
          {e.steps.length === 0 ? (
            <p className="text-sm text-ink-dim">{active ? 'Starting…' : 'No steps were executed.'}</p>
          ) : (
            <ol className="space-y-1">
              {e.steps.map((s) => <StepItem key={s.step_key} step={s} />)}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
