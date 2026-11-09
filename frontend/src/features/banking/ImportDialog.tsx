import { CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';

import {
  useImportStatement,
  usePreviewStatement,
  type BankAccount,
  type ImportResult,
} from '@/api/banking';
import { errorMessage } from '@/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Badge, Metric, Table, Td, Th, Tr } from '@/components/ui/surface';

import { SignedAmount } from './parts';

const FIELD_LABELS: Record<string, string> = {
  booking_date: 'Date',
  value_date: 'Value date',
  amount: 'Amount',
  debit: 'Debit',
  credit: 'Credit',
  currency: 'Currency',
  description: 'Description',
  counterparty: 'Counterparty',
  reference: 'Reference',
};

function ImportSummary({ result }: { result: ImportResult }) {
  const { batch, reconciliation } = result;
  return (
    <div className="space-y-4">
      <Alert tone="success">
        Imported <strong>{batch.imported_count}</strong> new transaction
        {batch.imported_count === 1 ? '' : 's'} from {batch.filename}.
      </Alert>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="New" value={batch.imported_count} tone="success" />
        <Metric label="Already known" value={batch.duplicate_count} />
        <Metric label="Auto-matched" value={reconciliation.auto_matched} tone="success" />
        <Metric
          label="To review"
          value={reconciliation.suggested}
          tone={reconciliation.suggested > 0 ? 'warning' : 'neutral'}
        />
      </div>
      {batch.error_count > 0 && (
        <p className="text-sm text-ink-muted">
          {batch.error_count} line(s) could not be read (e.g. balance or summary rows).
        </p>
      )}
    </div>
  );
}

/** Upload a CSV statement: preview first (nothing stored), then import. */
export function ImportDialog({
  workspaceId,
  accounts,
  initialAccountId,
  onClose,
}: {
  workspaceId: string;
  accounts: BankAccount[];
  initialAccountId?: string;
  onClose: () => void;
}) {
  const [accountId, setAccountId] = useState(initialAccountId ?? accounts[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const preview = usePreviewStatement(workspaceId);
  const importer = useImportStatement(workspaceId);
  const account = accounts.find((a) => a.id === accountId);

  const runPreview = (next: File | null, forAccount = accountId) => {
    setFile(next);
    importer.reset();
    if (next && forAccount) preview.mutate({ accountId: forAccount, file: next });
    else preview.reset();
  };

  const data = preview.data;
  const nothingNew = data ? data.valid_rows - data.duplicate_rows <= 0 : true;

  return (
    <Modal
      open
      size="lg"
      onOpenChange={(open) => !open && onClose()}
      title="Import bank statement"
      description="Download the statement as CSV from your bank and upload it here. You will see a preview before anything is stored."
      footer={
        importer.data ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!file || !data || nothingNew}
              loading={importer.isPending}
              onClick={() => {
                if (file) importer.mutate({ accountId, file });
              }}
            >
              Import {data ? String(Math.max(data.valid_rows - data.duplicate_rows, 0)) : ''}{' '}
              transactions
            </Button>
          </>
        )
      }
    >
      {importer.data ? (
        <ImportSummary result={importer.data} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Account" required>
              {(p) => (
                <Select
                  {...p}
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    runPreview(file, e.target.value);
                  }}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Statement file (CSV)"
              required
              help={`Rows without a currency use ${account?.currency ?? 'the account currency'}. Max 5 MB.`}
            >
              {(p) => (
                <input
                  {...p}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:border-electric/60"
                  onChange={(e) => runPreview(e.target.files?.[0] ?? null)}
                />
              )}
            </Field>
          </div>

          {preview.isPending && <p className="text-sm text-ink-muted">Reading the statement…</p>}
          {preview.isError && <Alert tone="danger">{errorMessage(preview.error)}</Alert>}
          {importer.isError && <Alert tone="danger">{errorMessage(importer.error)}</Alert>}

          {data && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Rows" value={data.total_rows} />
                <Metric label="Readable" value={data.valid_rows} tone="success" />
                <Metric label="Already imported" value={data.duplicate_rows} />
                <Metric
                  label="Unreadable"
                  value={data.errors.length}
                  tone={data.errors.length ? 'warning' : 'neutral'}
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                <FileSpreadsheet className="size-4 text-cyan" aria-hidden />
                Detected columns:
                {Object.entries(data.columns).map(([field, header]) => (
                  <Badge key={field} tone="info">
                    {FIELD_LABELS[field] ?? field} ← {header}
                  </Badge>
                ))}
              </div>
              {nothingNew && (
                <Alert tone="info">
                  <CheckCircle2 className="mr-1 inline size-4" aria-hidden />
                  Every readable row is already imported for this account.
                </Alert>
              )}
              {data.sample.length > 0 && (
                <Table aria-label="Statement preview">
                  <thead>
                    <tr>
                      <Th>Line</Th>
                      <Th>Date</Th>
                      <Th>Description</Th>
                      <Th className="text-right">Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sample.slice(0, 8).map((row) => (
                      <Tr key={row.line}>
                        <Td className="font-mono text-xs text-ink-dim">{row.line}</Td>
                        <Td className="whitespace-nowrap">{row.booking_date}</Td>
                        <Td className="max-w-80 truncate" title={row.description}>
                          {row.counterparty || row.description}
                        </Td>
                        <Td className="text-right">
                          <SignedAmount amount={row.amount} currency={row.currency} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {data.errors.length > 0 && (
                <details className="rounded-md border border-line bg-base/40 px-3 py-2 text-sm">
                  <summary className="cursor-pointer text-ink-muted">
                    {data.errors.length} unreadable line(s) — usually balance or summary rows
                  </summary>
                  <ul className="mt-2 space-y-0.5 font-mono text-xs text-ink-dim">
                    {data.errors.map((e) => (
                      <li key={e.line}>
                        line {e.line}: {e.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
