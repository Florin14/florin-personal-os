import { ShieldAlert } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';

import { useApproval, useDecideApproval } from '@/api/approvals';
import { errorMessage } from '@/api/client';
import { dateTime, relativeTime } from '@/components/data/format';
import { KeyValueView } from '@/components/data/KeyValueView';
import { StatusChip } from '@/components/data/StatusChip';
import { ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Panel } from '@/components/ui/surface';
import { CodeField } from '@/features/auth/CodeField';
import { useNow } from '@/hooks/useNow';

export function ApprovalDetail({ id }: { id: string }) {
  const approval = useApproval(id);
  const decide = useDecideApproval();
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const now = useNow();

  if (approval.isPending) return <LoadingState />;
  if (approval.isError) return <ErrorState error={approval.error} onRetry={() => void approval.refetch()} />;
  const a = approval.data;
  const pending = a.status === 'pending';
  const expired = pending && new Date(a.expires_at).getTime() <= now;
  const needsCode = a.requires_step_up;

  const send = (decision: 'approve' | 'reject') => {
    decide.mutate(
      { id: a.id, decision, note, ...(needsCode && decision === 'approve' ? { mfaCode: code } : {}) },
      { onSettled: () => setCode('') },
    );
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    send('approve');
  };
  const deciding = decide.isPending ? decide.variables.decision : null;

  return (
    <Panel aria-label="Approval detail">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex-1 font-display text-xl font-semibold">{a.title}</h2>
          <StatusChip status={a.status} />
          <StatusChip status={a.risk_level} prefix="risk" />
        </div>
        {a.summary && <p className="text-sm">{a.summary}</p>}
        <p className="text-xs text-ink-dim">
          Action <code className="font-mono text-cyan">{a.action_type}</code> · requested {dateTime(a.created_at)} ·{' '}
          {pending ? `expires ${relativeTime(a.expires_at)}` : `decided ${dateTime(a.decided_at)}`}
        </p>
        <div>
          <p className="label-caps mb-1.5">Exact parameters to be executed</p>
          <div className="rounded-md border border-line bg-base/50 px-3">
            <KeyValueView data={a.payload} label="Approval parameters" />
          </div>
          <p className="mt-1.5 font-mono text-[10.5px] text-ink-dim">
            payload sha256 {a.payload_hash.slice(0, 16)}… · version {a.version_ref ?? '—'}
          </p>
        </div>
        {a.decision_note && <Alert>Note: {a.decision_note}</Alert>}
        {a.consumed_at && <Alert tone="success">Used by the execution on {dateTime(a.consumed_at)}.</Alert>}
        {pending && !expired && (
          <form onSubmit={submit} aria-label="Decision" className="space-y-3 border-t border-line pt-4">
            {decide.isError && <Alert tone="danger">{errorMessage(decide.error)}</Alert>}
            {needsCode && (
              <Alert tone="warning">
                <ShieldAlert className="mr-1 inline size-4" aria-hidden />
                High-risk action: approving requires a current two-factor code.
              </Alert>
            )}
            <Field label="Note (optional)">
              {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
            </Field>
            {needsCode && <CodeField value={code} onChange={setCode} />}
            <div className="flex gap-2">
              <Button type="submit" variant="success" disabled={needsCode && code.length !== 6} loading={deciding === 'approve'}>
                Approve
              </Button>
              <Button type="button" variant="danger" onClick={() => send('reject')} loading={deciding === 'reject'}>
                Reject
              </Button>
            </div>
          </form>
        )}
        {expired && <Alert tone="warning">This approval has expired.</Alert>}
      </div>
    </Panel>
  );
}
