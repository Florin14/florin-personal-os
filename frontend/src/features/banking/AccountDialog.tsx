import { useState } from 'react';

import { useSaveBankAccount, type BankAccount, type BankAccountInput } from '@/api/banking';
import { errorMessage } from '@/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';

/** Create or edit a bank account (metadata only — Personal OS never stores bank credentials). */
export function AccountDialog({
  workspaceId,
  account,
  onClose,
}: {
  workspaceId: string;
  account?: BankAccount;
  onClose: () => void;
}) {
  const save = useSaveBankAccount(workspaceId);
  const [form, setForm] = useState<BankAccountInput>({
    name: account?.name ?? '',
    bank_name: account?.bank_name ?? '',
    iban: account?.iban ?? '',
    currency: account?.currency ?? 'RON',
  });
  const hasTransactions = Object.values(account?.counts ?? {}).some((n) => n > 0);
  const submit = () =>
    save.mutate(
      {
        ...(account ? { id: account.id } : {}),
        body: { ...form, iban: form.iban?.trim() ? form.iban : null },
      },
      { onSuccess: onClose },
    );

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={account ? 'Edit bank account' : 'Add bank account'}
      description="Statements are imported from files you download from your bank. No bank login is ever requested."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={save.isPending}
            disabled={!form.name.trim() || !/^[A-Z]{3}$/.test(form.currency)}
          >
            {account ? 'Save' : 'Add account'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          {(p) => (
            <Input
              {...p}
              value={form.name}
              maxLength={100}
              placeholder="e.g. BT Business RON"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Bank">
          {(p) => (
            <Input
              {...p}
              value={form.bank_name}
              maxLength={100}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Currency"
          required
          help={hasTransactions ? 'Locked: transactions were imported.' : 'ISO code, e.g. RON'}
        >
          {(p) => (
            <Input
              {...p}
              value={form.currency}
              maxLength={3}
              disabled={hasTransactions}
              className="font-mono uppercase"
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
            />
          )}
        </Field>
        <Field label="IBAN" className="sm:col-span-2" help="Optional, for your reference.">
          {(p) => (
            <Input
              {...p}
              value={form.iban ?? ''}
              maxLength={50}
              spellCheck={false}
              className="font-mono"
              onChange={(e) => setForm({ ...form, iban: e.target.value })}
            />
          )}
        </Field>
      </div>
      {save.isError && (
        <Alert tone="danger" className="mt-3">
          {errorMessage(save.error)}
        </Alert>
      )}
    </Modal>
  );
}
