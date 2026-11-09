import {
  Check,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { useState } from 'react';

import {
  useBankAccounts,
  useBankImports,
  useBankTransactions,
  useDecideMatch,
  useDeleteBankAccount,
  useReconcile,
  useReviewQueue,
  useUndoImport,
  type BankAccount,
  type BankImport,
  type TransactionStatus,
} from '@/api/banking';
import { errorMessage } from '@/api/client';
import { dateTime, formatMoney, relativeTime } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Modal, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Badge, Panel, Table, Td, Th, Tr } from '@/components/ui/surface';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';

import { AccountDialog } from './AccountDialog';
import { ImportDialog } from './ImportDialog';
import { ConfidenceMeter, SignedAmount } from './parts';
import { TransactionDialog } from './TransactionDialog';

const STATUS_FILTERS: { value: TransactionStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'unmatched', label: 'Unmatched' },
  { value: 'suggested', label: 'To review' },
  { value: 'matched', label: 'Matched' },
  { value: 'ignored', label: 'Ignored' },
];

function AccountCard({
  account,
  canEdit,
  canAdmin,
  onImport,
  onEdit,
  onDelete,
}: {
  account: BankAccount;
  canEdit: boolean;
  canAdmin: boolean;
  onImport: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { counts } = account;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const done = (counts.matched ?? 0) + (counts.ignored ?? 0);
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <Panel as="article" aria-label={account.name}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-electric/40 bg-electric/10 text-electric-soft">
          <Landmark className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display font-semibold">{account.name}</p>
          <p className="truncate font-mono text-xs text-ink-dim">
            {[account.bank_name, account.iban, account.currency].filter(Boolean).join(' · ')}
          </p>
        </div>
        {canAdmin && (
          <div className="flex">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${account.name}`}
              onClick={onEdit}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${account.name}`}
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-ink-muted">
            {total} transaction{total === 1 ? '' : 's'}
          </span>
          <span className="font-mono text-ink-dim">{percent}% reconciled</span>
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${account.name} reconciled`}
        >
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${String(percent)}%` }}
          />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(counts.suggested ?? 0) > 0 && <Badge tone="info">{counts.suggested} to review</Badge>}
          {(counts.unmatched ?? 0) > 0 && (
            <Badge tone="warning">{counts.unmatched} unmatched</Badge>
          )}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-xs text-ink-dim">
          {account.last_import_at
            ? `Last import ${relativeTime(account.last_import_at)}`
            : 'No statement yet'}
        </span>
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={onImport}>
            <Upload /> Import CSV
          </Button>
        )}
      </div>
    </Panel>
  );
}

function ReviewQueue({
  workspaceId,
  canEdit,
  onOpen,
}: {
  workspaceId: string;
  canEdit: boolean;
  onOpen: (transactionId: string) => void;
}) {
  const review = useReviewQueue(workspaceId);
  const decide = useDecideMatch(workspaceId);
  if (review.isPending) return <LoadingState />;
  if (review.isError) {
    return <ErrorState error={review.error} onRetry={() => void review.refetch()} />;
  }
  if (review.data.length === 0) {
    return (
      <EmptyState
        title="Nothing to review"
        description="Uncertain matches appear here. Exact, unambiguous matches are confirmed automatically."
      />
    );
  }
  return (
    <div className="space-y-3">
      {decide.isError && <Alert tone="danger">{errorMessage(decide.error)}</Alert>}
      <ul className="space-y-3" aria-label="Review queue">
        {review.data.map(({ transaction: tx, suggestions }) => (
          <li key={tx.id} className="rounded-lg border border-line bg-base/30 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <button
                type="button"
                className="min-w-0 text-left hover:underline"
                onClick={() => onOpen(tx.id)}
              >
                <p className="truncate font-medium text-ink">
                  {tx.counterparty || tx.description || 'Transaction'}
                </p>
                <p className="font-mono text-xs text-ink-dim">{tx.booking_date}</p>
              </button>
              <SignedAmount amount={tx.amount} currency={tx.currency} />
            </div>
            <ul className="mt-2.5 space-y-1.5">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-cyan/20 bg-cyan/[0.03] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{s.target?.label ?? 'Deleted record'}</p>
                    {s.target && (
                      <p className="font-mono text-xs text-ink-dim">
                        {s.target.date} · {formatMoney(s.target.amount, s.target.currency)}
                      </p>
                    )}
                  </div>
                  <ConfidenceMeter value={s.confidence} />
                  {canEdit && (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="success"
                        disabled={decide.isPending}
                        aria-label={`Confirm ${s.target?.label ?? 'match'}`}
                        onClick={() => decide.mutate({ matchId: s.id, decision: 'confirm' })}
                      >
                        <Check /> Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decide.isPending}
                        aria-label={`Reject ${s.target?.label ?? 'match'}`}
                        onClick={() => decide.mutate({ matchId: s.id, decision: 'reject' })}
                      >
                        <X />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TransactionsTab({
  workspaceId,
  accounts,
  onOpen,
}: {
  workspaceId: string;
  accounts: BankAccount[];
  onOpen: (transactionId: string) => void;
}) {
  const [accountId, setAccountId] = useState('');
  const [status, setStatus] = useState<TransactionStatus | ''>('');
  const [q, setQ] = useState('');
  const transactions = useBankTransactions(workspaceId, {
    ...(accountId ? { accountId } : {}),
    ...(status ? { status } : {}),
    ...(q.trim().length >= 2 ? { q: q.trim() } : {}),
  });
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select
          aria-label="Account"
          value={accountId}
          className="w-auto min-w-44"
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Status"
          value={status}
          className="w-auto min-w-36"
          onChange={(e) => setStatus(e.target.value as TransactionStatus | '')}
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
        <div className="relative min-w-52 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-dim"
            aria-hidden
          />
          <Input
            aria-label="Search transactions"
            placeholder="Search counterparty, description, reference"
            value={q}
            className="pl-9"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <Panel>
        {transactions.isPending ? (
          <LoadingState />
        ) : transactions.isError ? (
          <ErrorState error={transactions.error} onRetry={() => void transactions.refetch()} />
        ) : transactions.data.length === 0 ? (
          <EmptyState title="No transactions" description="Import a CSV statement to begin." />
        ) : (
          <Table aria-label="Bank transactions">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Transaction</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
                <Th>Matched to</Th>
              </tr>
            </thead>
            <tbody>
              {transactions.data.map((tx) => (
                <Tr
                  key={tx.id}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => onOpen(tx.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onOpen(tx.id);
                  }}
                >
                  <Td className="whitespace-nowrap text-ink-muted">{tx.booking_date}</Td>
                  <Td className="max-w-96">
                    <p className="truncate">{tx.counterparty || tx.description || '—'}</p>
                    <p className="truncate text-xs text-ink-dim">
                      {accounts.length > 1 ? `${names.get(tx.account_id) ?? ''} · ` : ''}
                      {tx.counterparty ? tx.description : tx.reference}
                    </p>
                  </Td>
                  <Td className="text-right">
                    <SignedAmount amount={tx.amount} currency={tx.currency} />
                  </Td>
                  <Td>
                    <StatusChip status={tx.status} />
                  </Td>
                  <Td className="max-w-64 truncate text-ink-muted">{tx.matched?.label ?? ''}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

function ImportsTab({
  workspaceId,
  accounts,
  canAdmin,
}: {
  workspaceId: string;
  accounts: BankAccount[];
  canAdmin: boolean;
}) {
  const imports = useBankImports(workspaceId);
  const undo = useUndoImport(workspaceId);
  const [confirming, setConfirming] = useState<BankImport | null>(null);
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  return (
    <Panel>
      {imports.isPending ? (
        <LoadingState />
      ) : imports.isError ? (
        <ErrorState error={imports.error} onRetry={() => void imports.refetch()} />
      ) : imports.data.length === 0 ? (
        <EmptyState title="No imports yet" />
      ) : (
        <Table aria-label="Statement imports">
          <thead>
            <tr>
              <Th>File</Th>
              <Th>Account</Th>
              <Th>Period</Th>
              <Th className="text-right">New</Th>
              <Th className="text-right">Known</Th>
              <Th className="text-right">Unreadable</Th>
              <Th>Imported</Th>
              {canAdmin && <Th className="sr-only">Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {imports.data.map((imp) => (
              <Tr key={imp.id}>
                <Td className="max-w-56 truncate">{imp.filename}</Td>
                <Td className="text-ink-muted">{names.get(imp.account_id) ?? '—'}</Td>
                <Td className="font-mono text-xs whitespace-nowrap text-ink-muted">
                  {imp.first_date} → {imp.last_date}
                </Td>
                <Td className="text-right font-mono">{imp.imported_count}</Td>
                <Td className="text-right font-mono text-ink-dim">{imp.duplicate_count}</Td>
                <Td className="text-right font-mono text-ink-dim">{imp.error_count}</Td>
                <Td className="whitespace-nowrap text-ink-dim" title={dateTime(imp.created_at)}>
                  {relativeTime(imp.created_at)}
                </Td>
                {canAdmin && (
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(imp)}>
                      <Undo2 /> Undo
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {confirming && (
        <Modal
          open
          size="sm"
          onOpenChange={(open) => !open && setConfirming(null)}
          title="Undo this import?"
          description={`Removes the ${String(confirming.imported_count)} transaction(s) added by ${confirming.filename}, including their matches. Rows that were already known from another import stay.`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={undo.isPending}
                onClick={() => undo.mutate(confirming.id, { onSuccess: () => setConfirming(null) })}
              >
                Undo import
              </Button>
            </>
          }
        >
          {undo.isError ? (
            <Alert tone="danger">{errorMessage(undo.error)}</Alert>
          ) : (
            <p className="text-sm text-ink-muted">This is recorded in the audit log.</p>
          )}
        </Modal>
      )}
    </Panel>
  );
}

export function BankingPage() {
  const workspace = useCurrentWorkspace();
  const workspaceId = workspace?.id;
  const accounts = useBankAccounts(workspaceId);
  const reconcile = useReconcile(workspaceId);
  const removeAccount = useDeleteBankAccount(workspaceId);
  const [tab, setTab] = useState('review');
  const [importFor, setImportFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<BankAccount | 'new' | null>(null);
  const [deleting, setDeleting] = useState<BankAccount | null>(null);
  const [openTx, setOpenTx] = useState<string | null>(null);

  const canAdmin = workspace?.role === 'owner' || workspace?.role === 'admin';
  const canEdit = canAdmin || workspace?.role === 'member';
  const list = accounts.data ?? [];
  const toReview = list.reduce((n, a) => n + (a.counts.suggested ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Banking & Reconciliation"
        subtitle="Import CSV statements from your bank and match every payment to a document, expense or invoice. No bank login is ever requested."
        actions={
          <>
            {canEdit && list.length > 0 && (
              <Button
                variant="secondary"
                loading={reconcile.isPending}
                onClick={() => reconcile.mutate()}
              >
                <RefreshCw /> Reconcile now
              </Button>
            )}
            {canAdmin && (
              <Button variant="primary" onClick={() => setEditing('new')}>
                <Plus /> Add account
              </Button>
            )}
          </>
        }
      />

      {reconcile.data && (
        <Alert tone="success">
          Checked {reconcile.data.processed} open transaction(s): {reconcile.data.auto_matched}{' '}
          matched automatically, {reconcile.data.suggested} waiting for review.
        </Alert>
      )}
      {reconcile.isError && <Alert tone="danger">{errorMessage(reconcile.error)}</Alert>}

      {!workspaceId ? (
        <EmptyState title="No workspace selected" />
      ) : accounts.isPending ? (
        <LoadingState />
      ) : accounts.isError ? (
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            title="No bank accounts yet"
            description="Add an account, then import its statement as a CSV file exported from your bank."
            action={
              canAdmin && (
                <Button variant="primary" onClick={() => setEditing('new')}>
                  <Plus /> Add account
                </Button>
              )
            }
          />
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                canEdit={canEdit}
                canAdmin={canAdmin}
                onImport={() => setImportFor(a.id)}
                onEdit={() => setEditing(a)}
                onDelete={() => setDeleting(a)}
              />
            ))}
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Banking views">
              <TabsTrigger value="review">
                Review{toReview > 0 ? ` (${String(toReview)})` : ''}
              </TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
              <TabsTrigger value="imports">Imports</TabsTrigger>
            </TabsList>
            <TabsContent value="review" className="mt-4">
              <Panel>
                <ReviewQueue workspaceId={workspaceId} canEdit={canEdit} onOpen={setOpenTx} />
              </Panel>
            </TabsContent>
            <TabsContent value="transactions" className="mt-4">
              <TransactionsTab workspaceId={workspaceId} accounts={list} onOpen={setOpenTx} />
            </TabsContent>
            <TabsContent value="imports" className="mt-4">
              <ImportsTab workspaceId={workspaceId} accounts={list} canAdmin={canAdmin} />
            </TabsContent>
          </Tabs>
        </>
      )}

      {workspaceId && importFor !== null && (
        <ImportDialog
          workspaceId={workspaceId}
          accounts={list}
          initialAccountId={importFor}
          onClose={() => setImportFor(null)}
        />
      )}
      {workspaceId && editing && (
        <AccountDialog
          workspaceId={workspaceId}
          {...(editing === 'new' ? {} : { account: editing })}
          onClose={() => setEditing(null)}
        />
      )}
      {workspaceId && openTx && (
        <TransactionDialog
          workspaceId={workspaceId}
          transactionId={openTx}
          canEdit={canEdit}
          onClose={() => setOpenTx(null)}
        />
      )}
      {deleting && (
        <Modal
          open
          size="sm"
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete ${deleting.name}?`}
          description="Only accounts without transactions can be deleted; undo their imports first."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={removeAccount.isPending}
                onClick={() =>
                  removeAccount.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
                }
              >
                Delete account
              </Button>
            </>
          }
        >
          {removeAccount.isError ? (
            <Alert tone="danger">{errorMessage(removeAccount.error)}</Alert>
          ) : (
            <p className="text-sm text-ink-muted">This is recorded in the audit log.</p>
          )}
        </Modal>
      )}
    </div>
  );
}
