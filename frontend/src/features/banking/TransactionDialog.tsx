import { Check, EyeOff, Link2, RotateCcw, Undo2, X } from 'lucide-react';

import {
  useDecideMatch,
  useManualMatch,
  useSetIgnored,
  useTransactionCandidates,
  type MatchCandidate,
  type MatchInfo,
} from '@/api/banking';
import { errorMessage } from '@/api/client';
import { formatMoney } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/overlay';
import { Badge } from '@/components/ui/surface';
import { cn } from '@/lib/cn';

import { ConfidenceMeter, SignedAmount } from './parts';
import { ruleChips } from './rules';

type Target = NonNullable<MatchInfo['target']>;

function TargetLine({ target }: { target: Target }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm text-ink">{target.label}</p>
      <p className="font-mono text-xs text-ink-dim">
        {target.date} · {formatMoney(target.amount, target.currency)}
      </p>
    </div>
  );
}

function Evidence({ rule, reasons }: { rule: string; reasons: string[] }) {
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex flex-wrap gap-1">
        {ruleChips(rule).map((chip) => (
          <Badge key={chip} tone={chip === 'auto' ? 'success' : 'neutral'}>
            {chip}
          </Badge>
        ))}
      </div>
      {reasons.length > 0 && <p className="text-xs text-ink-dim">{reasons.join(' ')}</p>}
    </div>
  );
}

/** One transaction: its matches, candidate records and the decisions you can take. */
export function TransactionDialog({
  workspaceId,
  transactionId,
  canEdit,
  onClose,
}: {
  workspaceId: string;
  transactionId: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const detail = useTransactionCandidates(workspaceId, transactionId);
  const decide = useDecideMatch(workspaceId);
  const manual = useManualMatch(workspaceId);
  const ignore = useSetIgnored(workspaceId);
  const error = decide.error ?? manual.error ?? ignore.error;
  const busy = decide.isPending || manual.isPending || ignore.isPending;

  const tx = detail.data?.transaction;
  const matches = detail.data?.matches ?? [];
  const matchedKeys = new Set(
    matches.map((m) => (m.target ? `${m.target.target_type}:${m.target.target_id}` : m.id)),
  );
  const candidates = (detail.data?.candidates ?? []).filter(
    (c: MatchCandidate) => !matchedKeys.has(`${c.target.target_type}:${c.target.target_id}`),
  );
  const confirmed = matches.some((m) => m.status === 'confirmed');
  const ignored = tx?.status === 'ignored';

  return (
    <Modal
      open
      size="lg"
      onOpenChange={(open) => !open && onClose()}
      title="Bank transaction"
      footer={
        tx && canEdit ? (
          <>
            <Button
              variant="ghost"
              disabled={busy || confirmed}
              title={confirmed ? 'Undo the match first' : undefined}
              onClick={() => ignore.mutate({ transactionId: tx.id, ignored: !ignored })}
            >
              {ignored ? <RotateCcw /> : <EyeOff />}
              {ignored ? 'Restore' : 'Ignore (no document needed)'}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {detail.isPending ? (
        <LoadingState compact />
      ) : detail.isError ? (
        <ErrorState compact error={detail.error} onRetry={() => void detail.refetch()} />
      ) : tx ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line bg-base/40 p-3">
            <div className="min-w-0">
              <p className="font-medium text-ink">{tx.counterparty || tx.description || '—'}</p>
              {tx.counterparty && tx.description && (
                <p className="text-sm text-ink-muted">{tx.description}</p>
              )}
              <p className="mt-1 font-mono text-xs text-ink-dim">
                {tx.booking_date}
                {tx.reference ? ` · ref ${tx.reference}` : ''}
              </p>
            </div>
            <div className="text-right">
              <SignedAmount amount={tx.amount} currency={tx.currency} className="text-lg" />
              <div className="mt-1">
                <StatusChip status={tx.status} />
              </div>
            </div>
          </div>

          {error && <Alert tone="danger">{errorMessage(error)}</Alert>}

          {matches.length > 0 && (
            <section aria-label="Matches" className="space-y-2">
              <p className="label-caps">Matches</p>
              <ul className="space-y-2">
                {matches.map((m) => (
                  <li
                    key={m.id}
                    className={cn(
                      'flex flex-wrap items-start gap-3 rounded-md border p-3',
                      m.status === 'confirmed'
                        ? 'border-success/40 bg-success/[0.05]'
                        : m.status === 'rejected'
                          ? 'border-line opacity-60'
                          : 'border-cyan/30',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      {m.target ? (
                        <TargetLine target={m.target} />
                      ) : (
                        <p className="text-sm text-ink-muted">The matched record was deleted.</p>
                      )}
                      <Evidence rule={m.rule} reasons={m.reasons} />
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        <ConfidenceMeter value={m.confidence} />
                        <StatusChip status={m.status} />
                      </div>
                      {canEdit && m.status === 'suggested' && (
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            variant="success"
                            disabled={busy}
                            onClick={() => decide.mutate({ matchId: m.id, decision: 'confirm' })}
                          >
                            <Check /> Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => decide.mutate({ matchId: m.id, decision: 'reject' })}
                          >
                            <X /> Reject
                          </Button>
                        </div>
                      )}
                      {canEdit && m.status !== 'suggested' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => decide.mutate({ matchId: m.id, decision: 'remove' })}
                        >
                          <Undo2 /> {m.status === 'confirmed' ? 'Undo match' : 'Forget rejection'}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!confirmed && !ignored && (
            <section aria-label="Candidates" className="space-y-2">
              <p className="label-caps">
                {tx.amount.startsWith('-')
                  ? 'Documents & expenses that could explain this payment'
                  : 'Issued invoices this could pay'}
              </p>
              {candidates.length === 0 ? (
                <p className="text-sm text-ink-dim">
                  No record in the same currency and date window. Add the document or expense in
                  Finance, then reconcile again — or ignore this transaction.
                </p>
              ) : (
                <ul className="space-y-2">
                  {candidates.map((c) => (
                    <li
                      key={`${c.target.target_type}:${c.target.target_id}`}
                      className="flex flex-wrap items-start gap-3 rounded-md border border-line p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <TargetLine target={c.target} />
                        <Evidence rule={c.rule} reasons={c.reasons} />
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <ConfidenceMeter value={c.confidence} />
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              manual.mutate({
                                transactionId: tx.id,
                                targetType: c.target.target_type,
                                targetId: c.target.target_id,
                              })
                            }
                          >
                            <Link2 /> Match
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
