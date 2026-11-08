import { Download, FileUp, Pencil, Plus, ReceiptText, Trash2, Wallet } from 'lucide-react';
import { useRef, useState } from 'react';

import { errorMessage } from '@/api/client';
import {
  documentContentUrl,
  useDeleteExpense,
  useDocuments,
  useExpenses,
  useExpenseSummary,
  useSaveExpense,
  useUpdateDocument,
  useUploadDocument,
  type DocumentInfo,
  type Expense,
  type ExpenseInput,
} from '@/api/workspaceData';
import { formatMoney, relativeTime, sumMoney } from '@/components/data/format';
import { StatusChip } from '@/components/data/StatusChip';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Modal, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Badge, Metric, Panel, Table, Td, Th, Tr } from '@/components/ui/surface';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';

const DOC_CATEGORIES = ['invoice', 'receipt', 'statement', 'contract', 'other'] as const;
const EXPENSE_CATEGORIES = ['software', 'hardware', 'office', 'services', 'travel', 'transport', 'meals', 'utilities', 'rent', 'taxes', 'groceries', 'health', 'entertainment', 'other'] as const;

function DocumentDialog({ workspaceId, doc, onClose }: { workspaceId: string; doc: DocumentInfo; onClose: () => void }) {
  const update = useUpdateDocument(workspaceId);
  const [form, setForm] = useState({
    title: doc.title,
    category: doc.category,
    document_date: doc.document_date ?? '',
    vendor: doc.vendor ?? '',
    amount: doc.amount === null ? '' : String(doc.amount),
    currency: doc.currency ?? 'RON',
    status: doc.status,
  });
  const save = () =>
    update.mutate(
      {
        id: doc.id,
        body: {
          title: form.title,
          category: form.category,
          status: form.status,
          document_date: form.document_date || null,
          vendor: form.vendor || null,
          amount: form.amount || null,
          currency: form.amount ? form.currency : null,
        },
      },
      { onSuccess: onClose },
    );
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Document details"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={update.isPending}>Save</Button></>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">{(p) => <Input {...p} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
        <Field label="Category">
          {(p) => <Select {...p} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as typeof form.category })}>{DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>}
        </Field>
        <Field label="Status">
          {(p) => <Select {...p} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}><option value="inbox">inbox</option><option value="processed">processed</option><option value="archived">archived</option></Select>}
        </Field>
        <Field label="Document date">{(p) => <Input {...p} type="date" value={form.document_date} onChange={(e) => setForm({ ...form, document_date: e.target.value })} />}</Field>
        <Field label="Vendor">{(p) => <Input {...p} value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />}</Field>
        <Field label="Amount" help="Exact decimal, e.g. 149.90">{(p) => <Input {...p} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />}</Field>
        <Field label="Currency">{(p) => <Input {...p} value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />}</Field>
        {update.isError && <Alert tone="danger" className="sm:col-span-2">{errorMessage(update.error)}</Alert>}
      </div>
    </Modal>
  );
}

function DocumentsPanel({ workspaceId }: { workspaceId: string }) {
  const docs = useDocuments(workspaceId);
  const upload = useUploadDocument(workspaceId);
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<string>('invoice');
  const [editing, setEditing] = useState<DocumentInfo | null>(null);
  return (
    <Panel
      title="Documents"
      icon={<ReceiptText />}
      action={
        <div className="flex items-center gap-2">
          <Select aria-label="Category for upload" value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 w-32 text-xs">
            {DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <input
            ref={input}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.xml,application/pdf,image/png,image/jpeg,application/xml,text/xml"
            className="sr-only"
            aria-label="Upload document"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate({ file, category });
              e.target.value = '';
            }}
          />
          <Button size="sm" variant="primary" onClick={() => input.current?.click()} loading={upload.isPending}><FileUp /> Upload</Button>
        </div>
      }
    >
      {upload.isError && <Alert tone="danger" className="mb-3">{errorMessage(upload.error)}</Alert>}
      <p className="mb-3 text-xs text-ink-dim">PDF, PNG, JPEG or e-Factura XML up to 10 MB. Files are checked by content, stored privately and only ever downloaded (never rendered).</p>
      {docs.isPending ? (
        <LoadingState compact />
      ) : docs.isError ? (
        <ErrorState compact error={docs.error} onRetry={() => void docs.refetch()} />
      ) : docs.data.length === 0 ? (
        <EmptyState compact title="No documents yet" description="Upload receipts and invoices, or import them from Gmail with a workflow." />
      ) : (
        <Table aria-label="Documents">
          <thead><tr><Th>Title</Th><Th>Category</Th><Th>Vendor</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {docs.data.map((d) => (
              <Tr key={d.id}>
                <Td>
                  <span className="block max-w-xs truncate">{d.title}</span>
                  <span className="font-mono text-[11px] text-ink-dim">{d.source} · {relativeTime(d.created_at)}</span>
                </Td>
                <Td><Badge>{d.category}</Badge></Td>
                <Td className="text-ink-muted">{d.vendor ?? '—'}</Td>
                <Td className="text-right font-mono tabular-nums">{d.amount === null ? '—' : formatMoney(String(d.amount), d.currency ?? '')}</Td>
                <Td><StatusChip status={d.status === 'archived' ? 'succeeded' : d.status === 'processed' ? 'active' : 'pending'} prefix={d.status} /></Td>
                <Td>
                  <div className="flex gap-1">
                    <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${d.title}`}>
                      <a href={documentContentUrl(workspaceId, d.id)} download><Download /></a>
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit ${d.title}`} onClick={() => setEditing(d)}><Pencil /></Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <DocumentDialog workspaceId={workspaceId} doc={editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function ExpenseDialog({ workspaceId, expense, onClose }: { workspaceId: string; expense?: Expense; onClose: () => void }) {
  const save = useSaveExpense(workspaceId);
  const [form, setForm] = useState<ExpenseInput>({
    document_id: expense?.document_id ?? null,
    expense_date: expense?.expense_date ?? today(),
    vendor: expense?.vendor ?? '',
    description: expense?.description ?? '',
    category: expense?.category ?? 'other',
    amount: expense ? String(expense.amount) : '',
    currency: expense?.currency ?? 'RON',
    vat_amount: expense?.vat_amount === undefined || expense.vat_amount === null ? null : String(expense.vat_amount),
    payment_method: expense?.payment_method ?? 'card',
    notes: expense?.notes ?? '',
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={expense ? 'Edit expense' : 'New expense'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ ...(expense ? { id: expense.id } : {}), body: form }, { onSuccess: onClose })}>Save</Button></>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date" required>{(p) => <Input {...p} type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />}</Field>
        <Field label="Vendor" required>{(p) => <Input {...p} value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />}</Field>
        <Field label="Amount" required help="Exact decimal">{(p) => <Input {...p} inputMode="decimal" value={String(form.amount)} onChange={(e) => setForm({ ...form, amount: e.target.value })} />}</Field>
        <Field label="Currency">{(p) => <Input {...p} maxLength={3} value={form.currency ?? 'RON'} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />}</Field>
        <Field label="Category">
          {(p) => <Select {...p} value={form.category ?? 'other'} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseInput['category'] })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>}
        </Field>
        <Field label="Payment">
          {(p) => <Select {...p} value={form.payment_method ?? 'card'} onChange={(e) => setForm({ ...form, payment_method: e.target.value as ExpenseInput['payment_method'] })}><option>card</option><option>transfer</option><option>cash</option><option>other</option></Select>}
        </Field>
        <Field label="Description" className="sm:col-span-2">{(p) => <Input {...p} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
        {save.isError && <Alert tone="danger" className="sm:col-span-2">{errorMessage(save.error)}</Alert>}
      </div>
    </Modal>
  );
}

function ExpensesPanel({ workspaceId }: { workspaceId: string }) {
  const year = new Date().getFullYear();
  const [month, setMonth] = useState<number | null>(new Date().getMonth() + 1);
  const expenses = useExpenses(workspaceId, year, month);
  const summary = useExpenseSummary(workspaceId, year);
  const remove = useDeleteExpense(workspaceId);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const totals = new Map<string, string[]>();
  for (const row of summary.data ?? []) {
    if (month && row.month !== month) continue;
    totals.set(row.category, [...(totals.get(row.category) ?? []), row.total]);
  }
  const currency = summary.data?.[0]?.currency ?? 'RON';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Month" value={month ?? 0} onChange={(e) => setMonth(Number(e.target.value) || null)} className="h-9 w-44">
          <option value={0}>All of {year}</option>
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i, 1).toLocaleString('en', { month: 'long' })} {year}</option>)}
        </Select>
        <Button variant="primary" onClick={() => setEditing('new')}><Plus /> New expense</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[...totals].slice(0, 4).map(([cat, values]) => <Metric key={cat} label={cat} value={formatMoney(sumMoney(values), currency)} />)}
        {totals.size === 0 && <Metric label="Total" value={formatMoney('0.00', currency)} />}
      </div>
      {remove.isError && <Alert tone="danger">{errorMessage(remove.error)}</Alert>}
      <Panel title="Expenses" icon={<Wallet />}>
        {expenses.isPending ? (
          <LoadingState compact />
        ) : expenses.isError ? (
          <ErrorState compact error={expenses.error} onRetry={() => void expenses.refetch()} />
        ) : expenses.data.length === 0 ? (
          <EmptyState compact title="No expenses for this period" />
        ) : (
          <Table aria-label="Expenses">
            <thead><tr><Th>Date</Th><Th>Vendor</Th><Th>Category</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
            <tbody>
              {expenses.data.map((e) => (
                <Tr key={e.id}>
                  <Td className="font-mono text-ink-muted">{e.expense_date}</Td>
                  <Td>{e.vendor}<span className="block text-xs text-ink-dim">{e.description}</span></Td>
                  <Td><Badge>{e.category}</Badge></Td>
                  <Td className="text-right font-mono tabular-nums">{formatMoney(String(e.amount), e.currency ?? 'RON')}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit expense ${e.vendor}`} onClick={() => setEditing(e)}><Pencil /></Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete expense ${e.vendor}`} onClick={() => remove.mutate(e.id)}><Trash2 /></Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      {editing && <ExpenseDialog workspaceId={workspaceId} {...(editing === 'new' ? {} : { expense: editing })} onClose={() => setEditing(null)} />}
    </div>
  );
}

export function FinancePage() {
  const workspace = useCurrentWorkspace();
  if (!workspace) return <EmptyState title="No workspace selected" />;
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={workspace.name}
        title="Finance"
        subtitle="Documents and expenses for this workspace. Bank statement import and reconciliation arrive in phase 5."
      />
      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
        </TabsList>
        <TabsContent value="documents" className="mt-4"><DocumentsPanel workspaceId={workspace.id} /></TabsContent>
        <TabsContent value="expenses" className="mt-4"><ExpensesPanel workspaceId={workspace.id} /></TabsContent>
      </Tabs>
    </div>
  );
}
